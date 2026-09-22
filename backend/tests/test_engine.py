"""Движок сверки: что он находит в демонстрационных кадрах и как ведёт предупреждения дальше."""

import pytest

from tests.conftest import login_as

pytestmark = pytest.mark.anyio


def _open(alerts: list[dict]) -> dict[tuple, dict]:
    return {(a["siteId"], a["kind"], a["equipment"]): a for a in alerts if a["isOpen"] and a["code"] >= "ОТК-26-0138"}


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
    # детский сад: всё по плану
    assert not [a for a in alerts if a["siteId"] == "s4" and a["isOpen"]]


async def test_gate_equipment_is_arriving_not_working(client):
    """Бетоносмеситель на въезде виден, но в норму рабочей зоны не засчитывается."""
    auth = await login_as(client, "manager")
    check = (await client.get("/api/sites/s2/equipment-check", headers=auth)).json()
    assert check["rows"] == [
        {"type": "mixer", "need": 2, "have": 1, "state": "low", "why": "Непрерывная подача бетона без «холодных швов»"}
    ]
    assert check["arriving"] == {"mixer": 1}


async def test_closed_by_person_is_not_raised_again_while_picture_is_the_same(client):
    foreman = await login_as(client, "foreman")
    alerts = (await client.get("/api/alerts?state=open", headers=foreman)).json()
    crane = next(a for a in alerts if a["kind"] == "unexpected")
    done = await client.post(
        f"/api/alerts/{crane['id']}/actions", headers=foreman, json={"status": "false_positive", "comment": "Кран согласован"}
    )
    assert done.json()["status"] == "false_positive"

    for _ in range(3):  # кран по-прежнему в кадре — три проверки подряд
        report = (await client.post("/api/sites/s1/capture", headers=foreman)).json()
        assert {"kind": "unexpected", "equipment": "crane"}.items() <= next(
            v for v in report["check"]["violations"] if v["kind"] == "unexpected"
        ).items()
    after = (await client.get("/api/alerts?siteId=s1", headers=foreman)).json()
    assert len([a for a in after if a["kind"] == "unexpected"]) == 1  # нового предупреждения не появилось


async def test_rule_change_rechecks_sites_and_auto_resolves(client):
    admin, manager = await login_as(client, "admin"), await login_as(client, "manager")
    rule = next(r for r in (await client.get("/api/rules", headers=admin)).json() if r["key"] == "foundation_concrete")
    rule["required"][0]["min"] = 1
    saved = await client.put("/api/rules/foundation_concrete", headers=admin, json=rule)
    assert saved.status_code == 200 and saved.json()["required"][0]["risk"]  # текст риска сохранился

    mixer = next(
        a
        for a in (await client.get("/api/alerts?siteId=s2", headers=manager)).json()
        if a["equipment"] == "mixer" and a["code"] >= "ОТК-26-0138"
    )
    assert mixer["status"] == "resolved"
    assert mixer["history"][-1]["who"] == "Система"


async def test_rule_validation(client):
    admin = await login_as(client, "admin")
    bad = {"required": [{"type": "crane", "min": 1}], "unexpected": [{"type": "crane"}], "confirmAfterSnapshots": 2}
    assert (await client.put("/api/rules/asphalt", headers=admin, json=bad)).status_code == 422
    foreman = await login_as(client, "foreman")
    assert (await client.put("/api/rules/asphalt", headers=foreman, json=bad)).status_code == 403


async def test_manual_capture_updates_open_alert_instead_of_duplicating(client):
    foreman = await login_as(client, "foreman")
    before = (await client.get("/api/alerts?state=open", headers=foreman)).json()
    report = (await client.post("/api/sites/s1/capture", headers=foreman)).json()
    assert report["errors"] == {"c3": "Камера не отвечает: нет сигнала"}  # склад «без сигнала»
    assert len(report["snapshots"]) == 2
    after = (await client.get("/api/alerts?state=open", headers=foreman)).json()
    assert len(after) == len(before)
    shortage = next(a for a in after if a["kind"] == "missing")
    assert shortage["evidence"][-1] in {s["id"] for s in report["snapshots"]}  # свежий кадр стал доказательством


async def test_cleanup_keeps_evidence_and_bounds_growth(client, monkeypatch):
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import CheckRun, Snapshot, alert_evidence
    from app.services import engine

    foreman = await login_as(client, "foreman")
    for _ in range(4):
        await client.post("/api/sites/s1/capture", headers=foreman)

    monkeypatch.setattr(engine.settings, "keep_frames_per_camera", 2)
    monkeypatch.setattr(engine, "KEEP_CHECKS_PER_SITE", 3)
    async with SessionLocal() as session:
        evidence_before = set(await session.scalars(select(alert_evidence.c.snapshot_id)))
        assert await engine.cleanup_frames(session) > 0
        left = set(await session.scalars(select(Snapshot.id)))
        assert evidence_before <= left  # ни один кадр-доказательство не удалён
        assert await session.scalar(select(func.count()).select_from(CheckRun).where(CheckRun.site_id == "s1")) == 3
    # интерфейс после чистки работает как прежде
    assert (await client.get("/api/alerts", headers=foreman)).status_code == 200
