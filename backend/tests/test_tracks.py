"""Рамки в реальном времени: разбор сообщений сервиса разметки, его доступ к камерам, права браузера на поток рамок."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services import video
from app.services.tracks import get_relay, normalize

settings = get_settings()


def test_normalize_keeps_only_valid_objects():
    raw = {
        "camera_id": "c1",
        "ts": "2026-09-25T10:15:03.120+03:00",
        "objects": [
            {"track_id": 17, "type": "excavator", "confidence": 0.93, "box": {"x": 90, "y": 10, "w": 30, "h": 20}},
            {"track_id": 18, "type": "person", "confidence": 0.99, "box": {"x": 1, "y": 1, "w": 5, "h": 5}},  # не техника
            {"track_id": 19, "type": "crane", "confidence": 97, "box": {"x": 1, "y": 1, "w": 5, "h": 5}},  # проценты вместо 0..1
            {"track_id": 20, "type": "roller", "box": {"x": 1}},  # рамка без размеров
        ],
    }
    message, problems = normalize(raw)
    assert message == {
        "cameraId": "c1",
        "ts": "2026-09-25T10:15:03.120+03:00",
        # рамка не выходит за кадр: x сдвинут так, чтобы x + w ≤ 100
        "objects": [
            {"trackId": "17", "type": "excavator", "confidence": 0.93, "box": {"x": 70.0, "y": 10.0, "w": 30.0, "h": 20.0}}
        ],
    }
    assert problems == [
        "камера c1: confidence = 97 — похоже на проценты, нужна доля от 0 до 1",
        'камера c1: box должен быть {"x", "y", "w", "h"} с числами',
    ]
    assert normalize({"camera_id": "c1"})[0] is None and normalize([1, 2])[0] is None


def test_normalize_pads_boxes_of_non_16_9_cameras():
    raw = {
        "camera_id": "c1",
        "frame_w": 1600,
        "frame_h": 1200,
        "objects": [{"track_id": 1, "type": "crane", "confidence": 0.9, "box": {"x": 0, "y": 0, "w": 100, "h": 100}}],
    }
    assert normalize(raw)[0]["objects"][0]["box"] == {"x": 12.5, "y": 0, "w": 75.0, "h": 100}  # как видео 4:3 в плеере 16:9


def test_normalize_explains_common_integration_mistakes():
    yolo = {
        "camera_id": "c1",
        "objects": [{"track_id": 1, "type": "crane", "confidence": 0.9, "box": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}}],
    }
    message, problems = normalize(yolo)
    assert message["objects"] == [] and "в долях 0–1" in problems[0]
    no_track = {"camera_id": "c1", "objects": [{"type": "crane", "confidence": 0.9, "box": {"x": 10, "y": 20, "w": 30, "h": 40}}]}
    message, problems = normalize(no_track)
    assert message["objects"][0]["trackId"] == "crane#0" and "нет track_id" in problems[0]  # рамку всё же показываем


@pytest.mark.anyio
async def test_tracker_camera_list_needs_its_key(client, monkeypatch):
    assert (await client.get("/api/tracker/cameras")).status_code == 503  # сервис не подключён
    monkeypatch.setattr(settings, "tracker_api_key", "tracker-key")
    assert (await client.get("/api/tracker/cameras", headers={"X-Api-Key": "wrong"})).status_code == 401
    cameras = (await client.get("/api/tracker/cameras", headers={"X-Api-Key": "tracker-key"})).json()
    c1 = next(c for c in cameras if c["id"] == "c1")
    assert c1["rtspUrl"].endswith("/cam-c1") and "@" not in c1["rtspUrl"]  # пароль в адрес не кладём
    assert c1["zoneKind"] == "work" and c1["siteId"] == "s1"


@pytest.mark.anyio
async def test_tracker_may_only_read_camera_streams(client, monkeypatch):
    monkeypatch.setattr(settings, "tracker_api_key", "tracker-key")

    async def ask(**body) -> int:
        return (
            await client.post("/api/video/auth", json={"user": video.TRACKER_USER, "password": "tracker-key", **body})
        ).status_code

    assert await ask(action="read", path="cam-c4") == 200
    assert await ask(action="publish", path="cam-c4") == 401  # подменить видео камеры нельзя
    assert await ask(action="read", path="probe-abc") == 401
    assert await ask(action="read", path="cam-c4", password="wrong") == 401


def test_browser_gets_only_its_cameras(monkeypatch):
    # WebSocket умеет только синхронный TestClient: он поднимает приложение в своём потоке со своим циклом событий
    monkeypatch.setattr(
        settings, "tracker_url", "ws://tracker.invalid/stream"
    )  # включён: подключение к несуществующему сервису просто повторяется в фоне
    relay = get_relay()
    frame = {"objects": [{"track_id": 1, "type": "excavator", "confidence": 0.9, "box": {"x": 1, "y": 1, "w": 10, "h": 10}}]}

    with TestClient(app) as http:  # noqa: SIM117 — два контекста читаются по отдельности
        foreman = http.post("/api/auth/demo-login", json={"role": "foreman"}).json()["token"]
        with http.websocket_connect("/api/tracks") as ws:
            ws.send_text(json.dumps({"token": "garbage"}))
            assert ws.receive()["code"] == 4401
        with http.websocket_connect("/api/tracks") as ws:
            ws.send_text(json.dumps({"subscribe": ["c1"]}))  # без токена
            assert ws.receive()["code"] == 4401
        # токен — первым сообщением, а не в адресе: адреса попадают в журналы сервера и nginx
        with http.websocket_connect("/api/tracks") as ws:
            ws.send_text(json.dumps({"token": foreman, "subscribe": ["c1", "c4"]}))  # c4 — камера чужого объекта
            for _ in range(200):  # сервер разбирает подписку в своём потоке — ждём, пока она дойдёт
                if any(s.wanted for s in relay.subscribers):
                    break
                time.sleep(0.01)
            assert [s.wanted for s in relay.subscribers] == [{"c1"}]
            # публикуем в цикле событий сервера: очереди подписчиков не потокобезопасны
            http.portal.call(relay.publish, {"camera_id": "c4", **frame})
            http.portal.call(relay.publish, {"camera_id": "c1", **frame})
            got = json.loads(ws.receive_text())
            assert got["cameraId"] == "c1" and got["objects"][0]["trackId"] == "1"
