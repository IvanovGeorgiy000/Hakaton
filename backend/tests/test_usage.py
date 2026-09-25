"""Учёт работы техники по рамкам сервиса разметки, «кадры дня», вид объекта."""

from datetime import UTC, datetime

import pytest

from app.services.tracks import get_relay
from app.services.usage import UsageMeter
from tests.conftest import login_as

HOUR = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)


def _msg(camera: str, *objects: tuple[str, str, float]) -> dict:
    """objects: (track_id, тип, x) — рамка 10×10 % на высоте 40 %"""
    return {
        "cameraId": camera,
        "objects": [
            {"trackId": t, "type": k, "confidence": 0.9, "box": {"x": x, "y": 40, "w": 10, "h": 10}} for t, k, x in objects
        ],
    }


def test_meter_counts_presence_movement_and_gaps():
    meter = UsageMeter()
    # экскаватор стоит 10 с, самосвал за это же время проезжает 20 % кадра; по сообщению в секунду
    for i in range(11):
        meter.add(
            _msg("c1", ("1", "excavator", 30.0), ("2", "dump_truck", 10.0 + 2 * i)), now=float(i), wall=HOUR.replace(second=i)
        )
    meter.add(_msg("c1", ("1", "excavator", 30.0)), now=40.0, wall=HOUR.replace(second=40))  # 30 с тишины — не засчитываются
    cells = meter.take(now=40.0)
    excavator, truck = cells[("c1", HOUR, "excavator")], cells[("c1", HOUR, "dump_truck")]
    assert excavator.present_s == pytest.approx(12.0) and excavator.moving_s == 0  # 10 с + не больше 2 с за паузу
    assert truck.present_s == pytest.approx(10.0) and truck.moving_s == pytest.approx(6.0)  # движение видно с 5-й секунды
    assert excavator.max_count == 1 and meter.take(now=41.0) == {}


def test_two_machines_of_one_type_and_hour_boundary():
    meter = UsageMeter()
    meter.add(_msg("c1", ("1", "dump_truck", 10), ("2", "dump_truck", 50)), now=0, wall=HOUR.replace(minute=59, second=59))
    meter.add(_msg("c1", ("1", "dump_truck", 10)), now=1, wall=HOUR.replace(hour=11))
    cells = meter.take(now=1)
    assert cells[("c1", HOUR, "dump_truck")].max_count == 2
    assert cells[("c1", HOUR.replace(hour=11), "dump_truck")].present_s == 1  # секунда после 11:00 — уже в следующем часе


@pytest.mark.anyio
async def test_usage_is_saved_and_shown_by_site(client):
    relay = get_relay()
    relay.usage = UsageMeter()  # чистый счётчик: он общий на процесс, в нём могли остаться камеры других тестов
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    for i in range(5):
        relay.usage.add(_msg("c1", ("7", "excavator", 30)), now=float(i), wall=now)
        relay.usage.add(_msg("c4", ("8", "mixer", 30)), now=float(i), wall=now)
    assert await relay.flush() == 2
    relay.usage.add(_msg("c1", ("7", "excavator", 30)), now=5.0, wall=now)
    relay.usage.add(_msg("c1", ("7", "excavator", 30)), now=6.0, wall=now)
    await relay.flush()  # к той же строке часа — прибавляется

    manager = await login_as(client, "manager")
    rows = (await client.get("/api/sites/s1/equipment-usage", headers=manager)).json()
    assert rows == [
        {
            "hour": rows[0]["hour"],
            "cameraId": "c1",
            "zoneKind": "work",
            "type": "excavator",
            "maxCount": 1,
            "presentMin": 0.1,
            "movingMin": 0.0,
        }
    ]
    foreman = await login_as(client, "foreman")  # у прораба только объект s1, камера c4 — чужая
    assert (await client.get("/api/sites/s2/equipment-usage", headers=foreman)).status_code == 404


@pytest.mark.anyio
async def test_daily_frames_api(client):
    foreman = await login_as(client, "foreman")
    frames = (await client.get("/api/snapshots/daily?days=14", headers=foreman)).json()
    assert frames and all(f["daily"] for f in frames)
    assert all(f["cameraId"] in {"c1", "c2", "c3"} for f in frames)  # только камеры своего объекта


@pytest.mark.anyio
async def test_site_kind(client):
    manager = await login_as(client, "manager")
    sites = {s["id"]: s for s in (await client.get("/api/sites", headers=manager)).json()}
    assert sites["s3"]["kind"] == "road" and sites["s1"]["kind"] == "residential"
    created = (await client.post("/api/sites", headers=manager, json={"name": "Склад ГСМ", "kind": "industrial"})).json()
    assert created["kind"] == "industrial"
    renamed = await client.patch(f"/api/sites/{created['id']}", headers=manager, json={"name": "Склад ГСМ, корпус 2"})
    assert renamed.json()["kind"] == "industrial"  # форма без поля «вид» его не сбрасывает
    assert (await client.post("/api/sites", headers=manager, json={"name": "Объект", "kind": "castle"})).status_code == 422
