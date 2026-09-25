"""Этап по камерам: запрос к сервису этапов (кадры + context), разбор ответа, показ рядом с графиком, расписание."""

import json
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app import mock_stage
from app.config import get_settings
from app.db import SessionLocal, utcnow
from app.models import EquipmentUsage, Site, StageEstimate, new_id
from app.services import stage
from app.services.engine import current_stage, local_day
from tests.conftest import check, feed, login_as

pytestmark = pytest.mark.anyio
settings = get_settings()


async def _fresh_site() -> None:
    """Камеры s1 только что прислали кадры: котлован — экскаватор и самосвал, въезд — автокран."""
    await feed("c1", "pit-loading")
    await feed("c2", "gate-crane")
    await check("s1")


async def _planned() -> tuple[str, str]:
    async with SessionLocal() as session:
        work = await current_stage(session, "s1", local_day(utcnow()))
        return work.id, work.name


def _client(handler) -> stage.StageClient:  # noqa: ANN001
    return stage.StageClient("http://stage.test/stage", "stage-key", 5, transport=httpx.MockTransport(handler))


def _parse(request: httpx.Request) -> tuple[dict, dict[str, bytes]]:
    """Разобрать multipart-запрос сервера, как это сделает сервис этапов."""
    boundary = request.headers["content-type"].split("boundary=")[1].encode()
    context, frames = None, {}
    for part in request.content.split(b"--" + boundary)[1:-1]:
        head, _, body = part.strip(b"\r\n").partition(b"\r\n\r\n")
        name = head.split(b'name="')[1].split(b'"')[0].decode()
        if name == "context":
            context = json.loads(body)
        else:
            frames[name] = body
    return context, frames


async def test_request_has_current_frames_and_context(client):
    await _fresh_site()
    now = utcnow()
    hour = now.replace(minute=0, second=0, microsecond=0)
    async with SessionLocal() as session:
        # одну машину видят две камеры рабочей зоны — в истории максимум по камерам, а не сумма
        for camera_id, minutes in (("c1", 50), ("c3", 5)):
            session.add(
                EquipmentUsage(
                    site_id="s1",
                    camera_id=camera_id,
                    zone_kind="work",
                    hour=hour,
                    equipment_type="excavator",
                    max_count=1,
                    present_s=minutes * 60,
                    moving_s=minutes * 30,
                )  # fmt: skip
            )
        await session.commit()
        context, frames = await stage.build_request(session, await session.get(Site, "s1"), now)

    json.dumps(context)  # уходит как JSON — всё в нём сериализуется
    assert context["site"] == {"id": "s1", "name": "ЖК «Северный парк», корпус 3", "kind": "residential"}
    cameras = {c["id"]: c for c in context["cameras"]}
    pit = cameras["c1"]
    assert pit["online"] and pit["frame"] == "frame_c1" and pit["zone_kind"] == "work" and pit["zone"] == "Котлован, оси А–Д"
    assert {o["type"] for o in pit["objects"]} == {"excavator", "dump_truck"} and pit["taken_at"].endswith("+03:00")
    assert frames["frame_c1"].startswith(b"\xff\xd8") and set(frames) == {c["frame"] for c in context["cameras"] if c["online"]}
    # прошлых снимков нет — только текущие кадры; история — числами
    assert "daily" not in context and all(name.startswith("frame_") for name in frames)
    last_hour = context["history"]["hourly"][-1]
    assert last_hour["work"]["excavator"] == {"max": 1, "minutes": 50.0, "moving_minutes": 25.0}
    assert context["history"]["daily"][-1]["work"]["excavator"]["minutes"] == 50.0
    plan = {item["id"]: item for item in context["plan"]}
    excavation = plan["s1-excavation"]
    assert excavation["parent_id"] == "s1-l1-earth" and excavation["level"] == 2 and excavation["start"]
    assert {"type": "excavator", "min": 1} in excavation["rule"]["required"] and plan["s1-l1-earth"]["rule"] is None
    ids = [item["id"] for item in context["plan"]]
    assert ids.index("s1-l1-earth") < ids.index("s1-excavation")  # этап, за ним его работы
    assert context["previous"] == [] and context["options"] == {"blind": False} and context["schema"] == 1


async def test_answer_is_shown_next_to_the_plan(client, monkeypatch):
    await _fresh_site()
    planned_id, planned_name = await _planned()
    seen: list[tuple[dict, dict]] = []

    def service(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer stage-key"
        context, frames = _parse(request)
        seen.append((context, frames))
        return httpx.Response(
            200,
            json={
                "request_id": context["request_id"],
                "stage_id": planned_id,
                "confidence": 0.84,
                "evidence": [{"camera_id": "c1", "text": "экскаватор грузит самосвал"}],  # вариант контракта без reason
                "model": "stage-v1",
            },
        )

    monkeypatch.setattr(settings, "stage_url", "http://stage.test/stage")
    monkeypatch.setattr(stage, "_client", _client(service))
    manager, foreman = await login_as(client, "manager"), await login_as(client, "foreman")
    assert (await client.post("/api/sites/s1/stage-estimate", headers=foreman)).status_code == 403
    answer = (await client.post("/api/sites/s1/stage-estimate", headers=manager)).json()
    assert answer["latest"]["stageId"] == planned_id and answer["latest"]["stageName"] == planned_name
    assert answer["latest"]["confidence"] == 0.84 and answer["latest"]["model"] == "stage-v1"
    assert answer["latest"]["reason"] == "Камера 1 — котлован: экскаватор грузит самосвал"
    assert answer["matchesPlan"] is True and answer["plannedStageId"] == planned_id and answer["error"] is None
    assert answer["canRun"] is True and answer["nextAt"]
    context, frames = seen[0]
    assert "frame_c1" in frames and frames["frame_c1"].startswith(b"\xff\xd8")
    shown = (await client.get("/api/sites/s1/stage-estimate", headers=foreman)).json()
    assert shown["latest"] == answer["latest"] and shown["canRun"] is False  # прораб видит, но не запускает

    # следующий запрос несёт прошлый ответ: этап редко откатывается назад
    await client.post("/api/sites/s1/stage-estimate", headers=manager)
    assert seen[1][0]["previous"] == [{"at": seen[1][0]["previous"][0]["at"], "stage_id": planned_id, "confidence": 0.84}]


async def test_bad_answers_are_kept_as_errors(client):
    await _fresh_site()
    planned_id, _ = await _planned()
    good = await stage.estimate(
        "s1",
        trigger="manual",
        client=_client(lambda r: httpx.Response(200, json={"stage_id": "unknown", "confidence": 0.2, "reason": "темно"})),
    )
    assert good.error is None and good.stage_id is None and good.stage_name is None and good.reason == "темно"

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("All connection attempts failed", request=request)

    cases = [
        (lambda r: httpx.Response(200, json={"stage_id": "st-99", "confidence": 0.9}), "нет в плане"),
        (lambda r: httpx.Response(200, json={"stage_id": planned_id, "confidence": 84}), "похоже на проценты"),
        (lambda r: httpx.Response(200, json={"request_id": "other", "stage_id": planned_id}), "не от этого запроса"),
        (lambda r: httpx.Response(200, json={"confidence": 0.9}), "нет stage_id"),
        (lambda r: httpx.Response(500, text="model crashed"), "ответил 500: model crashed"),
        (lambda r: httpx.Response(200, text="<html>"), "не JSON"),
        (timeout, "не ответил за 5 с"),
        (refused, "нет связи с сервисом этапов (http://stage.test/stage)"),
    ]
    for handler, text in cases:
        row = await stage.estimate("s1", trigger="schedule", client=_client(handler))
        assert row.error and text in row.error, (text, row.error)
    manager = await login_as(client, "manager")
    shown = (await client.get("/api/sites/s1/stage-estimate", headers=manager)).json()
    # прошлый нормальный ответ остаётся на экране, а сбой последнего запроса виден рядом
    assert shown["latest"]["reason"] == "темно" and shown["matchesPlan"] is None and "нет связи" in shown["error"]


async def test_service_off_or_nothing_to_look_at(client, monkeypatch):
    manager = await login_as(client, "manager")
    assert (await client.post("/api/sites/s1/stage-estimate", headers=manager)).status_code == 503
    state = (await client.get("/api/sites/s1/stage-estimate", headers=manager)).json()
    assert state["enabled"] is False and state["canRun"] is False and state["latest"] is None

    async def nothing_fresh(*_):  # noqa: ANN202
        return {}

    monkeypatch.setattr(settings, "stage_url", "http://stage.test/stage")
    monkeypatch.setattr(stage, "latest_snapshots", nothing_fresh)  # ни одна камера не прислала свежий кадр
    assert (await client.post("/api/sites/s1/stage-estimate", headers=manager)).status_code == 409


async def test_mock_service_end_to_end(client, monkeypatch):
    """Настоящий multipart через имитацию сервиса: кадры на месте, ответ по технике в рабочей зоне."""
    await _fresh_site()
    planned_id, planned_name = await _planned()
    monkeypatch.setattr(mock_stage, "DELAY_S", 0)
    monkeypatch.setattr(mock_stage, "API_KEY", "stage-key")
    via_mock = stage.StageClient("http://mock/stage", "stage-key", 5, transport=httpx.ASGITransport(app=mock_stage.app))
    row = await stage.estimate("s1", trigger="manual", client=via_mock)
    assert row.error is None and row.stage_id == planned_id and row.model == "mock-stage-1"
    assert "экскаватор" in row.reason and planned_name in row.reason
    stranger = stage.StageClient("http://mock/stage", "wrong", 5, transport=httpx.ASGITransport(app=mock_stage.app))
    assert "401" in (await stage.estimate("s1", trigger="manual", client=stranger)).error


def test_mock_service_checks_frames_and_decides():
    context = {
        "request_id": "r1",
        "now": "2026-09-25T14:00:00+03:00",
        "cameras": [
            {"id": "c1", "online": True, "frame": "frame_c1", "zone_kind": "work", "objects": [
                {"type": "excavator", "confidence": 0.9}, {"type": "dump_truck", "confidence": 0.8},
                {"type": "dump_truck", "confidence": 0.7}, {"type": "mixer", "confidence": 0.2},  # неуверенная — не в счёт
            ]},
            {"id": "c2", "online": True, "frame": "frame_c2", "zone_kind": "gate", "objects": [{"type": "crane", "confidence": 0.9}]},
        ],
        "history": {"hourly": [], "daily": []},
        "plan": [
            {"id": "w1", "level": 2, "name": "Разработка котлована", "start": "2026-09-01", "end": "2026-09-30",
             "rule": {"required": [{"type": "excavator", "min": 1}, {"type": "dump_truck", "min": 2}], "unexpected": ["mixer"]}},
            {"id": "w2", "level": 2, "name": "Бетонирование", "start": "2026-10-01", "end": "2026-10-30",
             "rule": {"required": [{"type": "mixer", "min": 1}], "unexpected": []}},
        ],
    }  # fmt: skip
    answer = mock_stage.decide(context)
    assert answer["stage_id"] == "w1" and answer["confidence"] == 0.95 and answer["request_id"] == "r1"
    assert answer["reason"] == "В рабочей зоне 2 самосвала, экскаватор — это техника работы «Разработка котлована»."
    context["cameras"][0]["objects"] = []  # автокран на въезде — не признак этапа
    assert mock_stage.decide(context)["stage_id"] == "unknown"

    with TestClient(mock_stage.app) as http:
        missing = http.post(
            "/stage", data={"context": json.dumps(context)}, files={"frame_c1": ("c1.jpg", b"\xff\xd8x", "image/jpeg")}
        )
        assert missing.status_code == 422 and "frame_c2" in missing.json()["detail"]


async def test_schedule_asks_only_due_sites(client, monkeypatch):
    asked: list[str] = []

    async def fake_estimate(site_id: str, *, trigger: str) -> None:
        asked.append(site_id)

    monkeypatch.setattr(stage, "estimate", fake_estimate)
    async with SessionLocal() as session:
        for site_id, ago in (("s1", 5), ("s2", 30)):  # s1 спрашивали 5 минут назад — рано; s2 — 30 минут назад — пора
            session.add(
                StageEstimate(
                    id=new_id("se"), site_id=site_id, at=utcnow() - timedelta(minutes=ago), trigger="schedule", request_id="r"
                )
            )
        await session.commit()
    await stage.StageScheduler().round()
    assert asked == ["s2", "s3", "s4"]
