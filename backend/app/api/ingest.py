"""Приём готовых детекций от внешнего сервиса анализа (push-режим).

Если сервис анализа сам забирает видео (например, из шлюза), он присылает сюда кадр и найденную технику.
Кадр попадает туда же, куда и результаты собственного конвейера, — в ближайшую сверку объекта (раз в минуту).
Чтобы сервер при этом не разбирал кадры сам, задайте SK_ANALYSIS_PROVIDER=push.
"""

import hmac
import json
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, status

from app.config import get_settings
from app.db import utcnow
from app.equipment import EQUIPMENT_TYPES
from app.models import Camera
from app.schemas import IngestOut
from app.security import Session
from app.services.analysis import AnalysisResult, DetectedObject
from app.services.analysis.base import clamp_box
from app.services.camera_client import CameraError, normalize_frame_async
from app.services.pipeline import CameraLive, LiveFrame, get_pipeline

settings = get_settings()
router = APIRouter(prefix="/ingest", tags=["Приём данных от сервиса анализа"])


def _confidence(value: object) -> float:
    """Уверенность — число от 0 до 1. NaN и «97» (проценты) отклоняем, а не пишем в базу."""
    number = float(value)  # type: ignore[arg-type]
    if not 0 <= number <= 1:  # NaN не проходит ни одно сравнение
        raise ValueError("confidence вне 0..1")
    return number


@router.post("/snapshots", response_model=IngestOut, status_code=status.HTTP_202_ACCEPTED, summary="Принять кадр с детекциями")
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
) -> IngestOut:
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

    now = utcnow()
    at = taken_at or now
    if at.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "taken_at должен содержать часовой пояс")
    if at > now + timedelta(minutes=1):  # местное время, присланное как UTC, сдвигало бы картину на часы вперёд
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Время кадра в будущем — проверьте часовой пояс")

    live = get_pipeline().live.setdefault(camera.id, CameraLive(camera.id))
    if live.frame and at <= live.frame.at:  # опоздавший кадр не должен менять текущую картину
        return IngestOut(accepted=False, detections=len(items), note="Кадр старее уже полученного с этой камеры — пропущен")
    provider = (model or "external")[:40]  # столбец provider — 40 символов
    frame = LiveFrame(at=at, jpeg=jpeg, result=AnalysisResult(provider=provider, detections=items, model=model))
    live.frame, live.online, live.error, live.received_at = frame, True, None, at
    live.history.append(frame)
    return IngestOut(accepted=True, detections=len(items), note="Кадр принят: попадёт в ближайшую сверку объекта")
