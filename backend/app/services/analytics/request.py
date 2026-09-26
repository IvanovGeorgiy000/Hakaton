"""Запрос сервисам аналитики по контракту frame-analysis-v1 (разделы 2–7): один кадр одной камеры + metadata.

Что уходит из нашей базы:
  • frame — снимок камеры: image_id — id снимка, байты кадра — отдельной частью запроса;
  • cv — техника от нашей модели: наши типы → коды классов справочника, рамки → доли кадра [x0, y0, x1, y1];
  • scope — участок. План объекта у нас одной цепочкой, поэтому участок на объект один («main»), весь кадр
    (roi_bbox = null). Отправляются только камеры рабочих зон: на въезде и складе техника подъезжает, а не работает;
  • plan — работы плана (уровень 2) с видом работ по справочнику. Версия плана — отпечаток содержимого: любая правка
    даёт новую. Хоть одна работа без вида по справочнику — план не отправляется (plan = null), причина хранится у нас;
  • history — журнал наблюдений камер участка за analytics_history_days дней (без картинок) и отметки выполнения
    руководителя: 0 % — не начата, 1–99 % — идёт, 100 % — завершена. Точных дат начала и окончания у нас нет —
    actual_* всегда null.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Camera, Observation, Site, Snapshot, Stage
from app.services.analytics.catalog import Catalog, object_type
from app.services.analytics.images import FrameImage, load_image
from app.services.analytics.observations import detections_of

INPUT_SCHEMA = "frame-analysis-input-v1"
STREAM = "main"
MAX_DETECTIONS = 200
MAX_STEPS = 500
MAX_OBSERVATIONS = 500
MAX_EVENTS = 1000
MAX_METADATA_BYTES = 1_000_000


class RequestProblem(Exception):
    """Запрос собрать нельзя: объяснение для администратора."""


@dataclass
class BuiltRequest:
    request_id: str
    metadata: dict
    body: bytes  # metadata ровно в том виде, как уходит
    image: FrameImage
    input_sha256: str
    plan_note: str | None  # почему план не отправлен
    notes: list[str] = field(default_factory=list)  # что ещё не попало в запрос

    @property
    def plan_revision_id(self) -> str | None:
        return self.metadata["plan"]["revision_id"] if self.metadata["plan"] else None


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def moment(value: datetime) -> str:
    """RFC 3339 с поясом объекта: 2026-09-26T12:00:00.000+03:00."""
    return value.astimezone(_tz()).isoformat(timespec="milliseconds")


def day_start(day: date) -> str:
    return datetime.combine(day, time.min, _tz()).isoformat(timespec="seconds")


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def serialize(metadata: dict) -> bytes:
    return json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def input_fingerprint(body: bytes, image: bytes) -> str:
    """input_sha256 (раздел 11): metadata как отправлена + байт 0x00 + байты кадра."""
    return hashlib.sha256(body + b"\x00" + image).hexdigest()


def bbox(x: float, y: float, w: float, h: float) -> list[float] | None:
    """Рамка в процентах (левый верхний угол, ширина, высота) → [x_min, y_min, x_max, y_max] в долях кадра."""
    x0, y0 = round(max(x / 100, 0.0), 6), round(max(y / 100, 0.0), 6)
    x1, y1 = round(min((x + w) / 100, 1.0), 6), round(min((y + h) / 100, 1.0), 6)
    return [x0, y0, x1, y1] if x0 < x1 and y0 < y1 else None


def cv_block(*, analyzed: bool, provider: str | None, model: str | None, detections: list[dict], catalog: Catalog,
             notes: list[str]) -> dict:  # fmt: skip
    """cv кадра (раздел 5). Анализ не удался — failed без рамок (демо-анализатор кадра не знает — unavailable)."""
    source = f"stroykontrol:analysis/{provider or 'unknown'}"
    if not analyzed:
        status = "unavailable" if provider == "mock" else "failed"
        return {"status": status, "source_ref": source, "model_version": model, "detections": []}
    items, skipped = [], set()
    for d in detections:
        code = catalog.class_code(d["type"])
        box = bbox(*d["box"])
        if code is None:
            skipped.add(d["type"])
        elif box is not None:
            confidence = d.get("confidence")
            items.append(
                {
                    "detection_id": f"d{d['id']}",
                    "class_code": code,
                    "bbox": box,
                    "confidence": None if confidence is None else round(min(max(float(confidence), 0.0), 1.0), 4),
                }
            )
    for kind in sorted(skipped):
        note = f"техника «{kind}» не отправлена: её класса нет в справочнике (задайте SK_ANALYTICS_CLASSES)"
        if note not in notes:
            notes.append(note)
    if len(items) > MAX_DETECTIONS:  # обрезать молча нельзя
        raise RequestProblem(f"на кадре {len(items)} рамок, а сервис принимает не больше {MAX_DETECTIONS}")
    return {"status": "ok", "source_ref": source, "model_version": model, "detections": items}


async def plan_works(session: AsyncSession, site_id: str) -> list[Stage]:
    """Работы плана (уровень 2) в порядке графика."""
    rows = await session.scalars(select(Stage).where(Stage.site_id == site_id, Stage.level == 2))
    return sorted(rows, key=lambda s: (s.start_date, s.position))


def plan_problem(works: list[Stage], catalog: Catalog | None, kind: str | None) -> str | None:
    """Почему план нельзя отправить сервисам; None — можно. Для запроса и для подсказки в интерфейсе."""
    if not works:
        return "в плане объекта нет работ"
    missing = [w.name for w in works if w.catalog_stage_id is None]
    if missing:
        return f"не выбран вид работ по справочнику: {', '.join(f'«{n}»' for n in missing[:5])}" + (
            " и др." if len(missing) > 5 else ""
        )
    if catalog is None:
        return None
    outdated = [w.name for w in works if w.catalog_version != catalog.version]
    if outdated:
        return (
            f"справочник сервисов обновился до версии {catalog.version} — проверьте вид работ у "
            + ", ".join(f"«{n}»" for n in outdated[:5])
            + (" и др." if len(outdated) > 5 else "")
        )
    for w in works:
        if problem := catalog.step_problem(w.catalog_stage_id, object_type(kind or "")):
            return f"«{w.name}»: {problem}"
    if len(works) > MAX_STEPS:
        return f"в плане {len(works)} работ, а сервис принимает не больше {MAX_STEPS}"
    return None


def plan_block(site: Site, works: list[Stage]) -> dict:
    steps = [
        {
            "step_key": w.id,
            "sequence_no": n,
            "stage_id": w.catalog_stage_id,
            "planned_start_at": day_start(w.start_date),
            "planned_end_at": day_start(w.end_date + timedelta(days=1)),  # дата окончания у нас включительно
        }
        for n, w in enumerate(works, start=1)
    ]
    plan_id = f"plan-{site.id}"
    return {
        "plan_id": plan_id,
        "revision_id": "rev-" + digest({"plan_id": plan_id, "stream": STREAM, "steps": steps})[:32],
        "source_ref": f"stroykontrol:sites/{site.id}/plan",
        "steps": steps,
    }


def progress_events(works: list[Stage], revision_id: str, as_of: datetime) -> list[dict]:
    """Отметки выполнения руководителя на момент кадра — подтверждённый ход работ (раздел 7)."""
    events = []
    for w in works:
        if w.fact_updated_at is None or w.fact_updated_at > as_of:
            continue
        state = "completed" if w.fact_progress >= 100 else "in_progress" if w.fact_progress > 0 else "not_started"
        at = moment(w.fact_updated_at)
        events.append(
            {
                "event_id": f"fact-{w.id}-{w.fact_updated_at.astimezone(_tz()):%Y%m%dT%H%M%S%f}",
                "step_key": w.id,
                "stage_id": w.catalog_stage_id,
                "plan_revision_id": revision_id,
                "state": state,
                "effective_at": at,
                "recorded_at": at,
                "source_ref": f"stroykontrol:stages/{w.id}/fact",
                "actual_started_at": None,
                "actual_completed_at": None,
            }
        )
    if len(events) > MAX_EVENTS:
        raise RequestProblem(f"отметок выполнения {len(events)}, а сервис принимает не больше {MAX_EVENTS}")
    return events


async def history_block(session: AsyncSession, *, site: Site, snapshot: Snapshot, catalog: Catalog, plan: dict | None,
                        works: list[Stage], notes: list[str]) -> dict:  # fmt: skip
    """Журнал наблюдений камер рабочих зон объекта за окно (без текущего кадра) и отметки выполнения.

    В запросе не больше 500 наблюдений. Если за окно их больше — окно укорачивается до последних 500 целиком
    (complete остаётся true: в укороченном окне переданы все записи), а не прореживается молча.
    """
    as_of = snapshot.taken_at
    window_start = as_of - timedelta(days=get_settings().analytics_history_days)
    rows = list(
        await session.scalars(
            select(Observation)
            .where(
                Observation.site_id == site.id,
                Observation.zone_kind == "work",
                Observation.observed_at >= window_start,
                Observation.observed_at <= as_of,
                Observation.image_id != snapshot.id,
            )
            .order_by(Observation.observed_at.desc(), Observation.id.desc())
            .limit(MAX_OBSERVATIONS + 1)
        )
    )
    if len(rows) > MAX_OBSERVATIONS:
        boundary = rows[MAX_OBSERVATIONS].observed_at
        rows = [r for r in rows[:MAX_OBSERVATIONS] if r.observed_at > boundary]
        window_start = rows[-1].observed_at if rows else as_of
        notes.append(f"история укорочена до {len(rows)} наблюдений: больше сервис не принимает")
    observations = [
        {
            "observation_id": f"obs-{r.id}",
            "image_id": r.image_id,
            "camera_id": r.camera_id,
            "observed_at": moment(r.observed_at),
            "source_ref": f"stroykontrol:snapshots/{r.image_id}",
            "image_sha256": r.image_sha256,
            "cv": cv_block(
                analyzed=r.analyzed, provider=r.provider, model=r.model, detections=r.detections, catalog=catalog, notes=notes
            ),
        }
        for r in reversed(rows)
    ]
    events = progress_events(works, plan["revision_id"], as_of) if plan else []
    body = {
        "as_of": moment(as_of),
        "window_start": moment(window_start),
        "complete": True,
        "observations": observations,
        "progress_events": events,
    }
    return {"snapshot_id": "hist-" + digest(body)[:32], **body}


async def build_request(session: AsyncSession, *, request_id: str, site: Site, camera: Camera, snapshot: Snapshot,
                        catalog: Catalog) -> BuiltRequest:  # fmt: skip
    """Собрать запрос по кадру камеры. Нельзя собрать (кадра нет, лимиты) — RequestProblem."""
    image = load_image(snapshot.image_url)
    notes: list[str] = []
    works = await plan_works(session, site.id)
    plan_note = plan_problem(works, catalog, site.kind)
    plan = None if plan_note else plan_block(site, works)
    metadata = {
        "schema_version": INPUT_SCHEMA,
        "request_id": request_id,
        "site_id": site.id,
        "object_type_code": object_type(site.kind),
        "catalog_version": catalog.version,
        "frame": {
            "image_id": snapshot.id,
            "camera_id": camera.id,
            "observed_at": moment(snapshot.taken_at),
            "source_ref": f"stroykontrol:snapshots/{snapshot.id}",
            "image_sha256": image.sha256,
            "media_type": image.media_type,
            "width": image.width,
            "height": image.height,
        },
        "scope": {
            "plan_stream_code": STREAM,
            "roi_bbox": None,
            "source_ref": f"stroykontrol:cameras/{camera.id}/zones/{camera.zone_id}",
        },
        "cv": cv_block(
            analyzed=snapshot.analyzed,
            provider=snapshot.provider,
            model=snapshot.model,
            detections=detections_of(snapshot),
            catalog=catalog,
            notes=notes,
        ),
        "plan": plan,
        "history": await history_block(
            session, site=site, snapshot=snapshot, catalog=catalog, plan=plan, works=works, notes=notes
        ),
    }
    body = serialize(metadata)
    if len(body) > MAX_METADATA_BYTES:
        raise RequestProblem(f"metadata {len(body)} байт, а сервис принимает не больше {MAX_METADATA_BYTES}")
    return BuiltRequest(
        request_id=request_id,
        metadata=metadata,
        body=body,
        image=image,
        input_sha256=input_fingerprint(body, image.data),
        plan_note=plan_note,
        notes=notes,
    )
