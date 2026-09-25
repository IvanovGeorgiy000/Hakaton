"""Этап стройки по кадрам: запрос к внешнему сервису этапов (например, языковой модели) и его ответы.

Раз в SK_STAGE_INTERVAL_MIN минут по каждому объекту (и по кнопке «Определить сейчас») сервер собирает один запрос
POST {SK_STAGE_URL}, multipart/form-data:
  • frame_<id камеры> — свежий кадр каждой камеры: JPEG 1280×720 без нарисованных рамок. Прошлые снимки не отправляются;
  • context — JSON: объект, камеры и техника на их кадрах, история работы техники (числа по часам и дням),
    календарный план с правилами «этап → техника» и прошлые ответы сервиса.
Ответ — JSON не дольше SK_STAGE_TIMEOUT_S: {"stage_id": id из plan или "unknown", "confidence": 0–1,
"reason": "почему так решено"}; вместо reason можно evidence: [{"camera_id", "text"}].
Ответы хранятся в stage_estimates: интерфейс показывает этап по камерам рядом с этапом по графику.
"""

import asyncio
import json
import logging
import math
import secrets
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ASSETS_DIR, get_settings
from app.db import SessionLocal, utcnow
from app.models import EquipmentUsage, Rule, Site, Stage, StageEstimate, new_id
from app.services.engine import TZ, latest_snapshots, local_day, site_cameras

log = logging.getLogger("stroykontrol.stage")
settings = get_settings()

SCHEMA = 1
PREVIOUS = 10  # сколько прошлых ответов отправлять: этап редко откатывается назад
HOURS, DAYS = 24, 14  # история: по часам — за сутки, по дням — за две недели
STARTUP_DELAY_S = 30.0  # после запуска сервера — подождать, пока сверка сохранит свежие кадры
ROUND_S = 60.0
CLEANUP_S = 3600.0


class StageError(Exception):
    """Сервис этапов не ответил или ответил не по формату — текст объясняет, что именно (его увидит администратор)."""


def _local(moment: datetime) -> str:
    """Время с часовым поясом объекта: 2026-09-25T14:05:00+03:00."""
    return moment.astimezone(TZ).isoformat(timespec="seconds")


def _frame(image_url: str) -> bytes | None:
    """JPEG снимка по его адресу в /media (кадры камер — в каталоге данных, демо-фото — в assets)."""
    for prefix, base in (("/media/frames/", settings.frames_dir), ("/media/seed/", ASSETS_DIR / "seed")):
        if image_url.startswith(prefix):
            path = (base / image_url.removeprefix(prefix)).resolve()
            if not path.is_relative_to(base.resolve()):
                return None
            try:
                return path.read_bytes()
            except OSError:
                return None
    return None


# ---------- запрос ----------
async def _cameras(session: AsyncSession, site_id: str, now: datetime) -> tuple[list[dict], dict[str, bytes]]:
    """Камеры объекта и что на их свежих кадрах; кадры — отдельными частями запроса."""
    fresh = await latest_snapshots(session, site_id, now)
    cameras, frames = [], {}
    for camera in await site_cameras(session, site_id):
        snapshot = fresh.get(camera.id)
        jpeg = _frame(snapshot.image_url) if snapshot else None
        part = f"frame_{camera.id}" if jpeg else None
        if part:
            frames[part] = jpeg
        cameras.append(
            {
                "id": camera.id,
                "name": camera.name,
                "zone": camera.zone.name,
                "zone_kind": camera.zone.kind,
                "online": part is not None,  # нет свежего кадра — камеры для сервиса сейчас нет
                "frame": part,
                "taken_at": _local(snapshot.taken_at) if part else None,
                "objects": [
                    {
                        "type": d.equipment_type,
                        "confidence": round(d.confidence, 3),
                        "box": {"x": d.x, "y": d.y, "w": d.w, "h": d.h},
                        "moving": d.moving,
                    }
                    for d in snapshot.detections
                ]
                if part
                else [],
            }
        )
    return cameras, frames


async def _history(session: AsyncSession, site_id: str, now: datetime) -> dict:
    """Сколько техники было: по часам за сутки и по дням за две недели — по видам зон и типам техники.

    Одну машину могут видеть две камеры одной зоны: по камерам берём максимум, а не сумму.
    """
    first_day = local_day(now) - timedelta(days=DAYS - 1)
    since = datetime.combine(first_day, datetime.min.time(), TZ)
    rows = await session.execute(
        select(
            EquipmentUsage.hour,
            EquipmentUsage.zone_kind,
            EquipmentUsage.equipment_type,
            func.max(EquipmentUsage.max_count),
            func.max(EquipmentUsage.present_s),
            func.max(EquipmentUsage.moving_s),
        )
        .where(EquipmentUsage.site_id == site_id, EquipmentUsage.hour >= since)
        .group_by(EquipmentUsage.hour, EquipmentUsage.zone_kind, EquipmentUsage.equipment_type)
    )
    hour_cut = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=HOURS - 1)
    hourly: dict[datetime, dict] = defaultdict(lambda: defaultdict(dict))
    daily: dict[date, dict] = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0.0, 0.0])))
    for hour, zone_kind, kind, max_count, present_s, moving_s in rows.all():
        if hour >= hour_cut:
            hourly[hour][zone_kind][kind] = _cell(max_count, present_s, moving_s)
        day = daily[local_day(hour)][zone_kind][kind]
        day[0], day[1], day[2] = max(day[0], max_count), day[1] + present_s, day[2] + moving_s
    return {
        "hourly": [{"hour": _local(h), **zones} for h, zones in sorted(hourly.items())],
        "daily": [
            {"date": d.isoformat(), **{z: {k: _cell(*v) for k, v in kinds.items()} for z, kinds in zones.items()}}
            for d, zones in sorted(daily.items())
        ],
    }


def _cell(max_count: int, present_s: float, moving_s: float) -> dict:
    return {"max": max_count, "minutes": round(present_s / 60, 1), "moving_minutes": round(moving_s / 60, 1)}


def _plan_item(stage: Stage, works: list[Stage], rules: dict[str, Rule]) -> dict:
    if works:  # у этапа выполнение — по его работам, с весом по длительности
        days = [(w.end_date - w.start_date).days + 1 for w in works]
        fact = round(sum(w.fact_progress * d for w, d in zip(works, days, strict=True)) / sum(days))
        marked = max((w.fact_updated_at for w in works if w.fact_updated_at), default=None)
    else:
        fact, marked = stage.fact_progress, stage.fact_updated_at
    rule = rules.get(stage.rule_key) if stage.rule_key else None
    blind = settings.stage_blind  # проверка модели «вслепую»: без дат ей не на что опереться, кроме кадров
    return {
        "id": stage.id,
        "parent_id": stage.parent_id,
        "level": stage.level,
        "name": stage.name,
        "start": None if blind else stage.start_date.isoformat(),
        "end": None if blind else stage.end_date.isoformat(),
        "fact": fact,
        "fact_marked_at": _local(marked) if marked else None,
        "rule": {
            "required": [{"type": i.equipment_type, "min": i.min_count} for i in rule.of_kind("required")],
            "unexpected": [i.equipment_type for i in rule.of_kind("unexpected")],
        }
        if rule
        else None,
    }


async def _plan(session: AsyncSession, site_id: str) -> list[dict]:
    """Календарный план: этап, за ним его работы — в порядке графика."""
    stages = list(await session.scalars(select(Stage).where(Stage.site_id == site_id)))
    keys = {s.rule_key for s in stages if s.rule_key}
    rules = {r.key: r for r in await session.scalars(select(Rule).where(Rule.key.in_(keys)))} if keys else {}
    ids = {s.id for s in stages}
    works: dict[str, list[Stage]] = defaultdict(list)
    for stage in stages:
        if stage.parent_id in ids:
            works[stage.parent_id].append(stage)

    def order(s: Stage) -> tuple:
        return s.start_date, s.position

    items = []
    for stage in sorted((s for s in stages if s.parent_id not in ids), key=order):
        children = sorted(works.get(stage.id, []), key=order)
        items.append(_plan_item(stage, children, rules))
        items += [_plan_item(work, [], rules) for work in children]
    return items


async def _previous(session: AsyncSession, site_id: str) -> list[dict]:
    rows = await session.scalars(
        select(StageEstimate)
        .where(StageEstimate.site_id == site_id, StageEstimate.error.is_(None))
        .order_by(StageEstimate.at.desc())
        .limit(PREVIOUS)
    )
    return [
        {"at": _local(e.at), "stage_id": e.stage_id or "unknown", "confidence": e.confidence}
        for e in reversed(list(rows))
        if e.stage_id or e.stage_name is None  # этап из ответа удалён из плана — такой ответ ничего не скажет
    ]


async def build_request(session: AsyncSession, site: Site, now: datetime) -> tuple[dict, dict[str, bytes]]:
    """(context, кадры по именам частей запроса)."""
    cameras, frames = await _cameras(session, site.id, now)
    context = {
        "schema": SCHEMA,
        "request_id": secrets.token_hex(6),
        "now": _local(now),
        "site": {"id": site.id, "name": site.name, "kind": site.kind},
        "cameras": cameras,
        "history": await _history(session, site.id, now),
        "plan": await _plan(session, site.id),
        "previous": await _previous(session, site.id),
        "options": {"blind": settings.stage_blind},
    }
    return context, frames


# ---------- ответ ----------
def read_answer(payload: Any, context: dict) -> tuple[str | None, float | None, str | None, str | None]:
    """Ответ сервиса → (stage_id или None для «не понять», уверенность, почему, модель). Не по формату — StageError."""
    if not isinstance(payload, dict):
        raise StageError('ответ должен быть JSON-объектом {"stage_id", "confidence", "reason"}')
    if payload.get("request_id") not in (None, context["request_id"]):
        raise StageError(f"request_id {payload['request_id']!r} — не от этого запроса ({context['request_id']})")
    if "stage_id" not in payload:
        raise StageError('в ответе нет stage_id — нужен id этапа или работы из plan либо "unknown"')
    stage_id = payload["stage_id"]
    if stage_id in (None, "unknown"):
        stage_id = None
    elif stage_id not in {item["id"] for item in context["plan"]}:
        raise StageError(f'stage_id {stage_id!r} нет в плане объекта — нужен id из plan либо "unknown"')
    confidence = payload.get("confidence")
    if confidence is not None:
        if isinstance(confidence, bool) or not isinstance(confidence, int | float) or not math.isfinite(confidence):
            raise StageError(f"confidence должно быть числом от 0 до 1, а пришло {confidence!r}")
        if not 0 <= confidence <= 1:
            hint = " — похоже на проценты, нужна доля от 0 до 1" if 1 < confidence <= 100 else ""
            raise StageError(f"confidence = {confidence}{hint}")
        confidence = round(float(confidence), 3)
    reason = payload.get("reason")
    if not isinstance(reason, str) or not reason.strip():  # второй вариант контракта: evidence по камерам
        names = {c["id"]: c["name"] for c in context["cameras"]}
        evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
        texts = [
            f"{names.get(e.get('camera_id'), e.get('camera_id') or 'камеры')}: {e['text'].strip()}"
            for e in evidence
            if isinstance(e, dict) and isinstance(e.get("text"), str) and e["text"].strip()
        ]
        reason = "; ".join(texts) or None
    model = payload.get("model")
    return stage_id, confidence, reason.strip()[:1000] if reason else None, model[:80] if isinstance(model, str) else None


class StageClient:
    def __init__(self, url: str, api_key: str | None, timeout_s: float, transport: httpx.AsyncBaseTransport | None = None):
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.url, self.timeout_s = url, timeout_s
        self._client = httpx.AsyncClient(timeout=timeout_s, headers=headers, transport=transport)

    async def ask(self, context: dict, frames: dict[str, bytes]) -> Any:
        files = [(name, (f"{name}.jpg", jpeg, "image/jpeg")) for name, jpeg in frames.items()]
        try:
            response = await self._client.post(self.url, data={"context": json.dumps(context, ensure_ascii=False)}, files=files)
        except httpx.TimeoutException:
            raise StageError(f"сервис этапов не ответил за {self.timeout_s:g} с") from None
        except httpx.ConnectError:
            raise StageError(f"нет связи с сервисом этапов ({self.url}): он не запущен или адрес неверный") from None
        except httpx.HTTPError as exc:
            raise StageError(f"сервис этапов недоступен: {exc}") from exc
        if response.status_code >= 400:
            raise StageError(f"сервис этапов ответил {response.status_code}: {response.text.strip()[:300]}")
        try:
            return response.json()
        except ValueError:
            raise StageError(f"ответ сервиса этапов — не JSON: {response.text.strip()[:200]}") from None


_client: StageClient | None = None


def get_client() -> StageClient:
    global _client
    if _client is None:
        if not settings.stage_url:
            raise StageError("сервис этапов не подключён: задайте SK_STAGE_URL")
        _client = StageClient(settings.stage_url, settings.stage_api_key, settings.stage_timeout_s)
    return _client


_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def estimate(site_id: str, *, trigger: str, client: StageClient | None = None) -> StageEstimate | None:
    """Спросить сервис этапов про объект и сохранить ответ (или ошибку).

    None — ни у одной камеры объекта нет свежего кадра: спрашивать не о чем, ничего не сохраняется.
    Пока сервис думает (до минуты), соединение с базой не держим.
    """
    async with _locks[site_id]:  # по кнопке во время планового запроса — второй запрос подождёт первый
        async with SessionLocal() as session:
            site = await session.get(Site, site_id)
            if site is None:
                return None
            now = utcnow()
            context, frames = await build_request(session, site, now)
        if not frames:
            return None
        row = StageEstimate(id=new_id("se"), site_id=site_id, at=now, trigger=trigger, request_id=context["request_id"])
        started = time.perf_counter()
        try:
            payload = await (client or get_client()).ask(context, frames)
            row.stage_id, row.confidence, row.reason, row.model = read_answer(payload, context)
            row.stage_name = next((item["name"] for item in context["plan"] if item["id"] == row.stage_id), None)
        except StageError as exc:
            row.error = str(exc)[:1000]
            log.warning("Этап объекта %s не определён: %s", site_id, exc)
        row.elapsed_ms = int((time.perf_counter() - started) * 1000)
        async with SessionLocal() as session:
            if row.stage_id and await session.get(Stage, row.stage_id) is None:
                row.stage_id = None  # этап удалили из плана, пока сервис думал: название из запроса остаётся
            session.add(row)
            await session.commit()
            await session.refresh(row)
        return row


# ---------- по расписанию ----------
class StageScheduler:
    """Раз в stage_interval_min минут — про каждый объект; старые ответы чистятся вместе с учётом техники."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if settings.stage_url and self._task is None:
            self._task = asyncio.create_task(self._loop(), name="stage-estimates")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _loop(self) -> None:
        loop = asyncio.get_running_loop()
        await asyncio.sleep(STARTUP_DELAY_S)
        cleaned = -math.inf
        while True:
            try:
                await self.round()
                if loop.time() - cleaned >= CLEANUP_S:
                    cleaned = loop.time()
                    async with SessionLocal() as session:
                        await cleanup_estimates(session)
            except Exception:  # noqa: BLE001 — сбой одного круга не останавливает расписание
                log.exception("Сбой планового определения этапов")
            await asyncio.sleep(ROUND_S)

    async def round(self) -> None:
        """Спросить про объекты, по которым последний запрос старше интервала (или его не было)."""
        async with SessionLocal() as session:
            site_ids = list(await session.scalars(select(Site.id).order_by(Site.position)))
            last = dict(
                (
                    await session.execute(
                        select(StageEstimate.site_id, func.max(StageEstimate.at)).group_by(StageEstimate.site_id)
                    )
                ).all()
            )
        due_before = utcnow() - timedelta(minutes=settings.stage_interval_min)
        for site_id in site_ids:  # по очереди: сервис этапов тяжёлый, объекты не наваливаем разом
            if last.get(site_id) is None or last[site_id] <= due_before:
                await estimate(site_id, trigger="schedule")


async def cleanup_estimates(session: AsyncSession) -> None:
    """Ответы старше keep_usage_days не нужны ни интерфейсу, ни сервису (ему уходят последние десять)."""
    await session.execute(delete(StageEstimate).where(StageEstimate.at < utcnow() - timedelta(days=settings.keep_usage_days)))
    await session.commit()


_scheduler: StageScheduler | None = None


def get_scheduler() -> StageScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = StageScheduler()
    return _scheduler
