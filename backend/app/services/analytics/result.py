"""Проверка ответа сервиса аналитики до сохранения (разделы 8 и 12 контракта).

Ответ должен относиться именно к этому запросу: те же кадр, версия плана, участок, снимок истории, справочник и
отпечаток входа. Несовпадение — технический конфликт, а не согласие. Кандидаты групп — пункты отправленного плана
с тем же stage_id. Полностью ответ проверяет схема контракта; здесь — то, без чего его нельзя показывать людям.
"""

from datetime import datetime
from typing import Any

from app.services.analytics.client import RESULT_SCHEMA

OUTCOMES = ("assessed", "insufficient_evidence", "outside_plan", "no_plan", "scope_unknown")
MAX_GROUPS = 8


def _same_moment(a: Any, b: str) -> bool:
    try:
        return datetime.fromisoformat(str(a)) == datetime.fromisoformat(b)
    except ValueError:
        return False


def check_result(payload: dict, *, service: str, metadata: dict, input_sha256: str) -> str | None:
    """Что не так с ответом; None — ответ относится к запросу и его можно показывать."""
    if payload.get("schema_version") != RESULT_SCHEMA:
        return f"schema_version ответа {payload.get('schema_version')!r}, а нужен {RESULT_SCHEMA}"
    if payload.get("request_id") != metadata["request_id"]:
        return f"request_id ответа {payload.get('request_id')!r} — не от этого запроса"
    if payload.get("service") != service:
        return f"ответ подписан сервисом {payload.get('service')!r}, а спрашивали {service}"
    context = payload.get("context")
    if not isinstance(context, dict):
        return "в ответе нет context"
    frame, plan = metadata["frame"], metadata["plan"]
    expected = {
        "site_id": metadata["site_id"],
        "camera_id": frame["camera_id"],
        "image_id": frame["image_id"],
        "image_sha256": frame["image_sha256"],
        "plan_id": plan["plan_id"] if plan else None,
        "plan_revision_id": plan["revision_id"] if plan else None,
        "plan_stream_code": metadata["scope"]["plan_stream_code"],
        "history_snapshot_id": metadata["history"]["snapshot_id"],
        "catalog_version": metadata["catalog_version"],
        "input_sha256": input_sha256,
    }
    for key, value in expected.items():
        if context.get(key) != value:
            return f"context.{key} ответа {context.get(key)!r} не совпадает с запросом ({value!r}) — ответ не к этому кадру"
    if not _same_moment(context.get("observed_at"), frame["observed_at"]):
        return f"context.observed_at ответа {context.get('observed_at')!r} не совпадает со временем кадра"

    current = payload.get("current_work")
    if not isinstance(current, dict) or current.get("status") not in OUTCOMES:
        return f"current_work.status должен быть одним из {', '.join(OUTCOMES)}"
    groups = current.get("work_groups")
    if not isinstance(groups, list) or len(groups) > MAX_GROUPS:
        return f"current_work.work_groups — список не длиннее {MAX_GROUPS}"
    if (current["status"] == "assessed") != bool(groups):
        return "группы работ должны быть только при status = assessed, и тогда хотя бы одна"
    steps = {s["step_key"]: s["stage_id"] for s in plan["steps"]} if plan else {}
    for n, group in enumerate(groups):
        candidates = group.get("candidates") if isinstance(group, dict) else None
        if not isinstance(candidates, list) or not candidates:
            return f"в группе {n} нет кандидатов"
        for c in candidates:
            if not isinstance(c, dict) or c.get("step_key") not in steps or steps[c["step_key"]] != c.get("stage_id"):
                return f"кандидат {c!r} группы {n} — не пункт отправленного плана"
    for block in ("transition", "schedule"):
        if not isinstance(payload.get(block), dict) or not isinstance(payload[block].get("status"), str):
            return f"в ответе нет {block}.status"
    return None
