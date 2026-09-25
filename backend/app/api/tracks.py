"""Рамки техники в реальном времени: список камер для сервиса разметки и поток рамок для браузера."""

import asyncio
import contextlib
import hmac
import json
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.api.deps import get_site
from app.config import get_settings
from app.db import SessionLocal, utcnow
from app.models import Camera, EquipmentUsage
from app.schemas import EquipmentUsageOut, TrackerCameraOut
from app.security import CurrentUser, Session, authenticate, visible_site_ids
from app.services import video
from app.services.tracks import Subscriber, get_relay

settings = get_settings()
router = APIRouter(tags=["Рамки в реальном времени"])

# Коды закрытия WebSocket (4000–4999 — свои): браузер по ним понимает, переподключаться или нет
WS_UNAUTHORIZED, WS_DISABLED = 4401, 4404
AUTH_TIMEOUT_S = 10.0  # столько ждём первое сообщение с токеном


@router.get(
    "/tracker/cameras",
    response_model=list[TrackerCameraOut],
    summary="Камеры для сервиса разметки",
    description="Какие потоки читать из шлюза. Логин шлюза — sk-tracker, пароль — ключ сервиса. Заголовок X-Api-Key — тот же ключ.",
)
async def tracker_cameras(session: Session, x_api_key: Annotated[str | None, Header()] = None) -> list[TrackerCameraOut]:
    key = settings.tracker_api_key
    if not key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Сервис разметки не подключён: задайте SK_TRACKER_API_KEY")
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), key.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный ключ")
    cameras = await session.scalars(
        select(Camera).where(Camera.enabled, Camera.deleted_at.is_(None)).order_by(Camera.site_id, Camera.position)
    )
    return [
        TrackerCameraOut(
            id=c.id,
            name=c.name,
            site_id=c.site_id,
            zone_kind=c.zone.kind,
            rtsp_url=video.tracker_rtsp_url(c.id),
            demo_clip=video.demo_clip_of(c.path),
        )
        for c in cameras
    ]


@router.get(
    "/sites/{site_id}/equipment-usage",
    response_model=list[EquipmentUsageOut],
    summary="Сколько работала техника по часам (по рамкам сервиса разметки)",
)
async def equipment_usage(
    site_id: str, user: CurrentUser, session: Session, hours: Annotated[int, Query(ge=1, le=24 * 30)] = 24
) -> list[EquipmentUsageOut]:
    """По часу, камере и типу техники: сколько машин сразу, сколько минут в кадре и сколько из них двигалась.
    Одну машину могут видеть две камеры — складывать минуты разных камер нельзя, лучше брать максимум по зоне."""
    await get_site(session, user, site_id)
    rows = await session.scalars(
        select(EquipmentUsage)
        .where(EquipmentUsage.site_id == site_id, EquipmentUsage.hour >= utcnow() - timedelta(hours=hours))
        .order_by(EquipmentUsage.hour, EquipmentUsage.camera_id, EquipmentUsage.equipment_type)
    )
    return [
        EquipmentUsageOut(
            hour=r.hour,
            camera_id=r.camera_id,
            zone_kind=r.zone_kind,
            type=r.equipment_type,
            max_count=r.max_count,
            present_min=round(r.present_s / 60, 1),
            moving_min=round(r.moving_s / 60, 1),
        )  # fmt: skip
        for r in rows
    ]


async def _first_message(ws: WebSocket) -> dict:
    try:
        message = json.loads(await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT_S))
    except (TimeoutError, ValueError):
        return {}
    return message if isinstance(message, dict) else {}


@router.websocket("/tracks")
async def tracks(ws: WebSocket) -> None:
    """Браузер: первым сообщением присылает {"token": "…", "subscribe": [id камер на экране]}, дальше — новые
    {"subscribe": […]}; получает рамки только этих камер — и только тех, что пользователю разрешено видеть.
    Токен — в сообщении, а не в адресе (?token=): адреса попадают в журналы сервера и nginx."""
    await ws.accept()
    relay = get_relay()
    if not relay.enabled:
        await ws.close(WS_DISABLED, "Сервис разметки не подключён")
        return
    try:
        first = await _first_message(ws)
    except WebSocketDisconnect:
        return
    token = first.get("token")
    if not isinstance(token, str) or not token:
        await ws.close(WS_UNAUTHORIZED, "Нужно войти в систему")
        return
    async with SessionLocal() as session:
        try:
            user = await authenticate(session, token)
        except HTTPException:
            await ws.close(WS_UNAUTHORIZED, "Нужно войти в систему")
            return
        sites = visible_site_ids(user)
        allowed = None
        if sites is not None:
            allowed = set(await session.scalars(select(Camera.id).where(Camera.site_id.in_(sites))))

    subscriber = Subscriber(allowed=allowed)
    if isinstance(first.get("subscribe"), list):
        subscriber.want(first["subscribe"])
    relay.subscribers.add(subscriber)

    async def send() -> None:
        while True:
            await ws.send_text(await subscriber.queue.get())

    sender = asyncio.create_task(send())
    try:
        while True:
            try:
                message = json.loads(await ws.receive_text())
            except ValueError:
                continue
            if isinstance(message, dict) and isinstance(message.get("subscribe"), list):
                subscriber.want(message["subscribe"])
    except WebSocketDisconnect:
        pass
    finally:
        relay.subscribers.discard(subscriber)
        sender.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await sender
