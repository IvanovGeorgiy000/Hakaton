"""Приём готовых детекций от внешнего сервиса анализа (push-режим).

Если сервис анализа сам забирает видео с камер, он присылает сюда кадр и найденную технику.
Дальше всё идёт по общему конвейеру: снимок сохраняется, объект сверяется с правилом этапа, обновляются предупреждения.
"""

import hmac
import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, status

from app.config import get_settings
from app.db import utcnow
from app.equipment import EQUIPMENT_TYPES
from app.models import Camera
from app.schemas import CaptureOut, check_out, snapshot_out
from app.security import Session
from app.services.analysis import DetectedObject
from app.services.analysis.base import clamp_box
from app.services.camera_client import CameraError, normalize_frame_async
from app.services.engine import process_frame, run_check

settings = get_settings()
router = APIRouter(prefix="/ingest", tags=["Приём данных от сервиса анализа"])


def _confidence(value: object) -> float:
    """Уверенность — число от 0 до 1. NaN и «97» (проценты) отклоняем, а не пишем в базу."""
    number = float(value)  # type: ignore[arg-type]
    if not 0 <= number <= 1:  # NaN не проходит ни одно сравнение
        raise ValueError("confidence вне 0..1")
    return number


@router.post("/snapshots", response_model=CaptureOut, summary="Принять кадр с детекциями")
async def ingest_snapshot(
    session: Session,
    camera_id: Annotated[str, Form()],
    detections: Annotated[
        str, Form(description='JSON: [{"type":"excavator","confidence":0.94,"box":{"x":..,"y":..,"w":..,"h":..}}]')
    ],
    image: Annotated[UploadFile, File()],
    taken_at: Annotated[datetime | None, Form()] = None,
    model: Annotated[str | None, Form()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> CaptureOut:
    if not settings.ingest_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Приём выключен: задайте SK_INGEST_API_KEY")
    # сравниваем байты: строка с не-ASCII символами роняла compare_digest в 500
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), settings.ingest_api_key.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный ключ")
    camera = await session.get(Camera, camera_id)
    if camera is None or camera.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Камера не найдена")
    try:
        items = [
            DetectedObject(d["type"], _confidence(d.get("confidence", 0)), *clamp_box(*(float(d["box"][k]) for k in "xywh")))
            for d in json.loads(detections)
            if d["type"] in EQUIPMENT_TYPES
        ]
        jpeg = await normalize_frame_async(await image.read(settings.max_frame_bytes + 1))
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Непонятный формат детекций") from None
    except CameraError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.message) from None

    at = taken_at or utcnow()
    if at.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "taken_at должен содержать часовой пояс")
    provider = (model or "external")[:40]  # столбец provider — 40 символов
    snapshot = await process_frame(session, camera, jpeg, at=at, source="ingest", detections=items, provider=provider)
    await session.flush()
    check = await run_check(session, camera.site_id, at=at, trigger="ingest")
    snapshot.check_id = check.id
    await session.commit()
    return CaptureOut(check=check_out(check), snapshots=[snapshot_out(snapshot)], errors={})
