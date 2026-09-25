"""Имитация сервиса этапов (вместо языковой модели коллеги) — тот же контракт, что в app/services/stage.py.

Принимает POST /stage (multipart: context — JSON, frame_<id камеры> — JPEG), проверяет запрос так же строго, как
настоящий сервис (кадры на месте и это JPEG, ключ совпадает), и отвечает правдоподобно, но без модели: этап — та
работа плана, чья нужная техника сейчас видна в рабочих зонах (или работала там последние часы), с поправкой
на лишнюю технику. Ответ: {"request_id", "stage_id", "confidence", "reason", "evidence", "model"}.

Запуск (рядом с сервером на :8100):
    uv run uvicorn app.mock_stage:app --port 8300
Сервер: SK_STAGE_URL=http://127.0.0.1:8300/stage (ключ, если нужен: SK_STAGE_API_KEY у обоих).
"""

import asyncio
import hmac
import json
import os
from collections import Counter
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request, status

from app.equipment import EQUIPMENT
from app.services.texts import plural

API_KEY = os.environ.get("SK_STAGE_API_KEY", "")
DELAY_S = float(os.environ.get("MOCK_STAGE_DELAY_S", "1.5"))  # «модель думает»: интерфейс успевает показать ожидание
RECENT_HOURS = 3  # «работала последние часы» — по истории
RECENT_MINUTES = 10  # сколько минут в час техника должна быть в кадре, чтобы считаться работавшей
MIN_CONFIDENCE = 0.4  # рамки неувереннее не учитываем
UNKNOWN_BELOW = 0.5

app = FastAPI(title="Имитация сервиса этапов")


def _describe(counts: dict[str, int]) -> str:
    """{'excavator': 1, 'dump_truck': 2} → «экскаватор, 2 самосвала»."""
    parts = []
    for kind, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        eq = EQUIPMENT[kind]
        parts.append(eq.name.lower() if n == 1 else f"{n} {plural(n, eq.name.lower(), eq.gen_sg, eq.gen_pl)}")
    return ", ".join(parts)


def decide(context: dict) -> dict:
    """Этап по тому, какая техника видна в рабочих зонах сейчас и работала там последние часы."""
    now_seen: Counter[str] = Counter()
    evidence = []
    for camera in context["cameras"]:
        if not camera["online"] or camera["zone_kind"] != "work":
            continue  # на въезде и складе техника только подъезжает — этап по ней не определить
        kinds = Counter(o["type"] for o in camera["objects"] if o["confidence"] >= MIN_CONFIDENCE and o["type"] in EQUIPMENT)
        for kind, n in kinds.items():
            now_seen[kind] = max(now_seen[kind], n)
        evidence.append({"camera_id": camera["id"], "text": _describe(kinds) or "техники не видно"})
    recent: Counter[str] = Counter()
    for hour in context["history"]["hourly"][-RECENT_HOURS:]:
        for kind, cell in hour.get("work", {}).items():
            if cell["minutes"] >= RECENT_MINUTES:
                recent[kind] = max(recent[kind], cell["max"])
    seen = {kind: max(now_seen[kind], recent[kind]) for kind in now_seen | recent}

    today = datetime.fromisoformat(context["now"]).date().isoformat()
    scores: dict[str, float] = {}
    for item in context["plan"]:
        rule = item.get("rule")
        if item["level"] != 2 or not rule or not rule["required"]:
            continue
        met = sum(min(seen.get(r["type"], 0) / r["min"], 1.0) for r in rule["required"]) / len(rule["required"])
        extra = sum(1 for kind in rule["unexpected"] if seen.get(kind))
        score = met - 0.25 * extra
        if item["start"] and item["end"] and item["start"] <= today <= item["end"]:
            score += 0.15  # работа идёт по графику — при равных признаках она вероятнее
        scores[item["id"]] = round(max(score, 0.0), 3)

    names = {item["id"]: item["name"] for item in context["plan"]}
    best = max(scores, key=lambda stage_id: scores[stage_id], default=None)
    common = {"request_id": context["request_id"], "scores": scores, "evidence": evidence, "model": "mock-stage-1"}
    if best is None or scores[best] < UNKNOWN_BELOW:
        where = f"в рабочей зоне {_describe(seen)}" if seen else "в рабочей зоне техники не видно"
        return {**common, "stage_id": "unknown", "confidence": 0.3, "reason": f"По кадрам не понять: {where}."}
    return {
        **common,
        "stage_id": best,
        "confidence": round(min(0.95, 0.5 + scores[best] / 2), 2),
        "reason": f"В рабочей зоне {_describe(seen)} — это техника работы «{names[best]}».",
    }


@app.post("/stage")
async def stage(request: Request) -> dict:
    if API_KEY and not hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {API_KEY}".encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный ключ")
    form = await request.form()
    try:
        context = json.loads(form.get("context") or "")
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Нет части context с JSON") from None
    for camera in context.get("cameras", []):  # как настоящий сервис: кадр каждой работающей камеры — на месте и JPEG
        if not camera["online"]:
            continue
        frame = form.get(camera["frame"] or "")
        data = await frame.read() if hasattr(frame, "read") else b""
        if not data.startswith(b"\xff\xd8"):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Нет кадра {camera['frame']!r} (JPEG) камеры {camera['id']}"
            )
    await asyncio.sleep(DELAY_S)
    return decide(context)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "delay_s": DELAY_S}
