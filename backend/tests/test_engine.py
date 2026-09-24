"""Движок сверки: что он находит в кадрах из видео и как ведёт предупреждения дальше."""

from datetime import timedelta

import pytest

from app.db import utcnow
from tests.conftest import check, feed, login_as

pytestmark = pytest.mark.anyio
MINUTE = timedelta(minutes=1)


def _open(alerts: list[dict]) -> dict[tuple, dict]:
    return {(a["siteId"], a["kind"], a["equipment"]): a for a in alerts if a["isOpen"] and a["code"] >= "ОТК-26-0138"}


async def _minutes(site_id: str, frames: dict[str, str], count: int, start=None):  # noqa: ANN001
    """count плановых сверок раз в минуту, на каждой камеры показывают одно и то же."""
    at = start or utcnow()
    for i in range(count):
        moment = at + i * MINUTE
        for camera_id, photo in frames.items():
            await feed(camera_id, photo, at=moment)
        await check(site_id, at=moment)
    return at + count * MINUTE


async def test_seed_story_is_produced_by_the_engine(client):
    auth = await login_as(client, "manager")
    alerts = (await client.get("/api/alerts", headers=auth)).json()
    today = _open(alerts)
    assert set(today) == {
        ("s1", "missing", "dump_truck"),
        ("s1", "unexpected", "crane"),
        ("s1", "camera_offline", None),
        ("s2", "count_below", "mixer"),
        ("s3", "count_below", "roller"),
        ("s3", "idle", "dump_truck"),
    }
    shortage = today[("s1", "missing", "dump_truck")]
    assert shortage["severity"] == "high" and shortage["expected"] == 2 and shortage["observed"] == 0
    assert "не меньше 2 самосвалов" in shortage["summary"]
    assert len(shortage["evidenceSnapshots"]) >= 3  # подтверждено тремя проверками — три кадра-доказательства
    assert today[("s3", "count_below", "roller")]["severity"] == "high"  # важность задана в правиле
    assert today[("s2", "count_below", "mixer")]["status"] == "acknowledged"  # прораб уже ответил
    assert not [a for a in alerts if a["siteId"] == "s4" and a["isOpen"]]  # детский сад: всё по плану


async def test_gate_equipment_is_arriving_not_working(client):
    """Бетоносмеситель на въезде виден, но в норму рабочей зоны не засчитывается."""
    await _minutes("s2", {"c4": "foundation-pump", "c5": "gate-mixer"}, 1)
    auth = await login_as(client, "manager")
    result = (await client.get("/api/sites/s2/equipment-check", headers=auth)).json()
    assert result["rows"] == [
        {"type": "mixer", "need": 2, "have": 1, "state": "low", "why": "Непрерывная подача бетона без «холодных швов»"}
    ]
    assert result["arriving"] == {"mixer": 1}


async def test_live_check_updates_open_alert_instead_of_duplicating(client):
    foreman = await login_as(client, "foreman")
    before = (await client.get("/api/alerts?state=open", headers=foreman)).json()
    await _minutes("s1", {"c1": "pit-excavator", "c2": "gate-crane"}, 1)  # у склада (c3) видео нет
    after = (await client.get("/api/alerts?state=open", headers=foreman)).json()
    assert len(after) == len(before)
    shortage = next(a for a in after if a["kind"] == "missing")
    assert shortage["evidenceSnapshots"][-1]["imageUrl"].startswith("/media/frames/c1/")  # свежий кадр из видео — доказательство
    cameras = {c["id"]: c for c in (await client.get("/api/cameras?siteId=s1", headers=foreman)).json()}
    assert cameras["c1"]["status"] == "online" and cameras["c3"]["status"] == "offline"


async def test_confirmation_needs_spaced_checks(client):
    """«3 проверки подряд» — это три минуты, а не три сверки за секунду (правка правила, приём извне)."""
    now = utcnow()
    for i in range(3):  # три сверки почти одновременно: на площадке детсада нет бульдозера
        await feed("c8", "pit-excavator", at=now + timedelta(seconds=i))
        await check("s4", at=now + timedelta(seconds=i), trigger="rule_change")
    manager = await login_as(client, "manager")
    assert not _open((await client.get("/api/alerts?siteId=s4", headers=manager)).json())

    await _minutes("s4", {"c8": "pit-excavator"}, 2, start=now + MINUTE)  # ещё две настоящие минуты
    raised = _open((await client.get("/api/alerts?siteId=s4", headers=manager)).json())
    assert ("s4", "missing", "bulldozer") in raised


async def test_closed_by_person_is_not_raised_again_while_picture_is_the_same(client):
    foreman = await login_as(client, "foreman")
    alerts = (await client.get("/api/alerts?state=open", headers=foreman)).json()
    crane = next(a for a in alerts if a["kind"] == "unexpected")
    done = await client.post(
        f"/api/alerts/{crane['id']}/actions", headers=foreman, json={"status": "false_positive", "comment": "Кран согласован"}
    )
    assert done.json()["status"] == "false_positive"

    await _minutes("s1", {"c1": "pit-excavator", "c2": "gate-crane"}, 4)  # кран по-прежнему в кадре
    after = (await client.get("/api/alerts?siteId=s1", headers=foreman)).json()
    assert len([a for a in after if a["kind"] == "unexpected"]) == 1  # нового предупреждения не появилось


async def test_pause_in_video_does_not_bring_back_closed_alert(client):
    """Камера въезда замолчала на время: «не видно» — не «картина изменилась». Закрытое человеком не возвращается."""
    foreman = await login_as(client, "foreman")
    crane = next(a for a in (await client.get("/api/alerts?state=open", headers=foreman)).json() if a["kind"] == "unexpected")
    await client.post(f"/api/alerts/{crane['id']}/actions", headers=foreman, json={"status": "false_positive", "comment": ""})

    end = await _minutes("s1", {"c1": "pit-excavator"}, 2)  # c2 молчит
    await _minutes("s1", {"c1": "pit-excavator", "c2": "gate-crane"}, 4, start=end + 3 * MINUTE)  # снова тот же кран
    after = (await client.get("/api/alerts?siteId=s1", headers=foreman)).json()
    assert len([a for a in after if a["kind"] == "unexpected"]) == 1


async def test_disabled_camera_alert_is_resolved_with_reason(client):
    admin, foreman = await login_as(client, "admin"), await login_as(client, "foreman")
    assert (await client.patch("/api/cameras/c2", headers=admin, json={"enabled": False})).status_code == 200
    await _minutes("s1", {"c1": "pit-excavator"}, 1)
    crane = next(a for a in (await client.get("/api/alerts?siteId=s1", headers=foreman)).json() if a["kind"] == "unexpected")
    assert crane["status"] == "resolved" and "Камера выключена или удалена" in crane["history"][-1]["text"]


async def test_rule_change_asks_for_recheck_and_auto_resolves(client):
    from app.services.pipeline import get_pipeline

    admin, manager = await login_as(client, "admin"), await login_as(client, "manager")
    rule = next(r for r in (await client.get("/api/rules", headers=admin)).json() if r["key"] == "foundation_concrete")
    rule["required"][0]["min"] = 1
    saved = await client.put("/api/rules/foundation_concrete", headers=admin, json=rule)
    assert saved.status_code == 200 and saved.json()["required"][0]["risk"]  # текст риска сохранился
    assert get_pipeline()._pending == {"s2"}  # школа сверится вне очереди — там сейчас бетонирование

    await _minutes("s2", {"c4": "foundation-pump"}, 1)
    mixer = next(
        a
        for a in (await client.get("/api/alerts?siteId=s2", headers=manager)).json()
        if a["equipment"] == "mixer" and a["code"] >= "ОТК-26-0138"
    )
    assert mixer["status"] == "resolved" and mixer["history"][-1]["who"] == "Система"


async def test_rule_validation(client):
    admin = await login_as(client, "admin")
    bad = {"required": [{"type": "crane", "min": 1}], "unexpected": [{"type": "crane"}], "confirmAfterSnapshots": 2}
    assert (await client.put("/api/rules/asphalt", headers=admin, json=bad)).status_code == 422
    foreman = await login_as(client, "foreman")
    assert (await client.put("/api/rules/asphalt", headers=foreman, json=bad)).status_code == 403


async def test_cleanup_keeps_evidence_and_bounds_growth(client, monkeypatch):
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import CheckRun, Snapshot, alert_evidence
    from app.services import engine

    await _minutes("s1", {"c1": "pit-excavator", "c2": "gate-crane"}, 4)
    monkeypatch.setattr(engine.settings, "keep_frames_per_camera", 2)
    monkeypatch.setattr(engine, "KEEP_CHECKS_PER_SITE", 3)
    async with SessionLocal() as session:
        evidence_before = set(await session.scalars(select(alert_evidence.c.snapshot_id)))
        assert await engine.cleanup_frames(session) > 0
        left = set(await session.scalars(select(Snapshot.id)))
        assert evidence_before <= left  # ни один кадр-доказательство не удалён
        assert await session.scalar(select(func.count()).select_from(CheckRun).where(CheckRun.site_id == "s1")) == 3
    foreman = await login_as(client, "foreman")
    assert (await client.get("/api/alerts", headers=foreman)).status_code == 200  # интерфейс после чистки работает
