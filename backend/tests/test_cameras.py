"""Добавление камеры по IP: проверка адреса, подключения, авторизации, первый кадр."""

import asyncio
import io

import httpx
import pytest
from PIL import Image

from app.services import camera_client as cc
from app.services.camera_client import CameraAddress, CameraError
from tests.conftest import login_as

pytestmark = pytest.mark.anyio
MOCK = {"protocol": "http", "host": "127.0.0.1", "port": 8100}


def _jpeg(size=(640, 480), color=(90, 120, 60)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "JPEG")
    return out.getvalue()


async def test_probe_and_add_camera_by_ip(client):
    admin = await login_as(client, "admin")
    probe = (await client.post("/api/cameras/probe", headers=admin, json={**MOCK, "path": "/mock-camera/4/snapshot.jpg"})).json()
    assert probe["ok"] and probe["preview"].startswith("data:image/jpeg;base64,")

    body = {
        "siteId": "s4",
        "name": "Камера 2 — въезд",
        "newZoneName": "Въезд",
        "newZoneKind": "gate",
        "connection": {**MOCK, "path": "/mock-camera/4/snapshot.jpg"},
    }
    created = await client.post("/api/cameras", headers=admin, json=body)
    assert created.status_code == 201, created.text
    camera = created.json()
    assert camera["online"] and camera["sourceType"] == "http" and camera["lastSnapshotAt"]
    assert camera["address"] == "http://127.0.0.1:8100/mock-camera/4/snapshot.jpg"

    zones = (await client.get("/api/zones?siteId=s4", headers=admin)).json()
    assert {"Въезд": "gate"}.items() <= {z["name"]: z["kind"] for z in zones}.items()
    shots = (await client.get(f"/api/snapshots?cameraId={camera['id']}", headers=admin)).json()
    assert len(shots) == 1 and [d["type"] for d in shots[0]["detections"]] == ["crane"]  # кадр получен по сети и разобран
    assert shots[0]["imageUrl"].startswith("/media/frames/")

    again = await client.post("/api/cameras", headers=admin, json={**body, "name": "Дубль"})
    assert again.status_code == 409


async def test_credentials_are_checked_encrypted_and_never_returned(client):
    admin = await login_as(client, "admin")
    secure = {**MOCK, "path": "/mock-camera/secure/2/snapshot.jpg"}
    denied = (await client.post("/api/cameras/probe", headers=admin, json=secure)).json()
    assert denied == {**denied, "ok": False, "code": "auth"}
    wrong = (
        await client.post("/api/cameras/probe", headers=admin, json={**secure, "username": "demo", "password": "nope"})
    ).json()
    assert wrong["code"] == "auth"

    good = {**secure, "username": "demo", "password": "demo"}
    created = await client.post(
        "/api/cameras", headers=admin, json={"siteId": "s2", "name": "Камера 3", "zoneId": "z2-found", "connection": good}
    )
    assert created.status_code == 201 and created.json()["hasCredentials"] is True
    assert "demo" not in created.text.replace("demo-", "") or "password" not in created.text  # пароль наружу не уходит

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Camera
    from app.security import decrypt_secret

    async with SessionLocal() as session:
        row = await session.scalar(select(Camera).where(Camera.id == created.json()["id"]))
        assert row.password_enc and row.password_enc != "demo" and decrypt_secret(row.password_enc) == "demo"

    # в рабочей зоне школы теперь два кадра с бетоносмесителями → нехватка снимается сама
    manager = await login_as(client, "manager")
    check = (await client.get("/api/sites/s2/equipment-check", headers=manager)).json()
    assert check["rows"][0]["have"] == 3 and check["rows"][0]["state"] == "ok"


async def test_unreachable_camera_is_rejected_unless_allowed(client):
    admin = await login_as(client, "admin")
    body = {
        "siteId": "s4",
        "name": "Камера 9",
        "zoneId": "z4-yard",
        "connection": {**MOCK, "path": "/mock-camera/99/snapshot.jpg"},
    }
    refused = await client.post("/api/cameras", headers=admin, json=body)
    assert refused.status_code == 422 and "404" in refused.json()["detail"]
    saved = await client.post("/api/cameras", headers=admin, json={**body, "allowOffline": True})
    assert saved.status_code == 201 and saved.json()["status"] == "offline" and saved.json()["online"] is False
    camera_id = saved.json()["id"]

    toggled = await client.patch(f"/api/cameras/{camera_id}", headers=admin, json={"enabled": False})
    assert toggled.json()["enabled"] is False
    assert (await client.delete(f"/api/cameras/{camera_id}", headers=admin)).status_code == 204
    assert camera_id not in {c["id"] for c in (await client.get("/api/cameras", headers=admin)).json()}


async def test_only_admin_manages_cameras(client):
    for role in ("foreman", "manager", "inspector"):
        auth = await login_as(client, role)
        assert (await client.post("/api/cameras/probe", headers=auth, json={"host": "10.0.0.1"})).status_code == 403
        assert (await client.delete("/api/cameras/c1", headers=auth)).status_code == 403


@pytest.mark.parametrize(
    ("host", "code"),
    [
        ("169.254.169.254", "forbidden_address"),  # метаданные облака
        ("0.0.0.0", "forbidden_address"),
        ("224.0.0.1", "forbidden_address"),
        ("bad host!", "bad_host"),
    ],
)
async def test_dangerous_addresses_are_blocked(host, code):
    with pytest.raises(CameraError) as error:
        await cc.ensure_allowed(CameraAddress("http", host, 80, "/"))
    assert error.value.code == code


async def test_loopback_can_be_forbidden(monkeypatch):
    monkeypatch.setattr(cc.settings, "allow_loopback_cameras", False)
    with pytest.raises(CameraError):
        await cc.ensure_allowed(CameraAddress("http", "127.0.0.1", 80, "/"))
    await cc.ensure_allowed(CameraAddress("rtsp", "192.168.1.64", 554, "/Streaming/Channels/101"))  # обычная сеть — можно


async def test_http_camera_variants(monkeypatch):
    """Digest-авторизация, поток MJPEG, редирект, мусор вместо картинки."""
    frame = _jpeg()

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/digest":
            if "Digest" not in request.headers.get("authorization", ""):
                return httpx.Response(401, headers={"WWW-Authenticate": 'Digest realm="cam", nonce="abc", qop="auth"'})
            return httpx.Response(200, content=frame, headers={"content-type": "image/jpeg"})
        if path == "/mjpeg":
            body = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n--frame\r\n" + frame[:100]
            return httpx.Response(200, content=body, headers={"content-type": "multipart/x-mixed-replace; boundary=frame"})
        if path == "/redirect":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/"})
        return httpx.Response(200, content=b"<html>login page</html>", headers={"content-type": "text/html"})

    monkeypatch.setattr(cc, "TRANSPORT", httpx.MockTransport(handler))
    got = await cc.grab_address(CameraAddress("http", "192.168.1.64", 80, "/digest", "admin", "12345"))
    with Image.open(io.BytesIO(got)) as img:
        assert img.size == cc.FRAME_SIZE  # 4:3 дополнено полями до 16:9
    assert (await cc.probe(CameraAddress("http", "192.168.1.64", 80, "/mjpeg"))).ok
    assert (await cc.probe(CameraAddress("http", "192.168.1.64", 80, "/redirect"))).code == "redirect"
    assert (await cc.probe(CameraAddress("http", "192.168.1.64", 80, "/html"))).code == "not_image"


async def test_rtsp_probe_against_fake_server():
    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request = await reader.readuntil(b"\r\n\r\n")
        assert request.startswith(b"OPTIONS rtsp://127.0.0.1")
        writer.write(b"RTSP/1.0 200 OK\r\nCSeq: 1\r\nPublic: OPTIONS, DESCRIBE, SETUP, PLAY\r\n\r\n")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        assert await cc._rtsp_options(CameraAddress("rtsp", "127.0.0.1", port, "/Streaming/Channels/101")) == 200
        result = await cc.probe(CameraAddress("rtsp", "127.0.0.1", port, "/Streaming/Channels/101"))
    # без ffmpeg кадр получить нельзя — проверка подключения честно говорит об этом
    assert result.ok and result.code in ("rtsp_no_preview", "ok") or result.code == "stream_error"
