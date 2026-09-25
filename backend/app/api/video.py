"""Видео: пропуск для шлюза (кому можно смотреть поток) и «что видит анализ прямо сейчас» по каждой камере."""

from collections import Counter
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import SiteIdQuery, scope
from app.models import Camera
from app.schemas import BoxOut, DetectionOut, LiveCameraOut
from app.security import CAMERA_ADDERS, CurrentUser, Session, authenticate, visible_site_ids
from app.services import video
from app.services.pipeline import CameraLive, get_pipeline

router = APIRouter(tags=["Видео"])
_ALLOW, _DENY = 200, 401


class GatewayAuthIn(BaseModel):
    """Запрос шлюза mediamtx (authMethod: http) перед каждым подключением к потоку."""

    user: str = ""
    password: str = ""
    token: str = ""  # из заголовка Authorization: Bearer … (так браузер передаёт вход при WebRTC)
    ip: str = ""
    action: str = ""  # publish | read | playback …
    path: str = ""
    protocol: str = ""
    id: str | None = None
    query: str = ""


@router.post("/video/auth", include_in_schema=False)
async def gateway_auth(body: GatewayAuthIn, session: Session) -> Response:
    """200 — пустить, 401 — нет. Смотреть поток камеры может тот, кто видит её объект; публиковать — только сервер."""
    if video.is_internal(body.user, body.password):
        return Response(status_code=_ALLOW)  # сам сервер: публикует демо-ролики, берёт кадры на анализ
    if video.is_tracker(body.user, body.password):  # сервис разметки: только читать потоки камер и только по RTSP
        # WebRTC с тем же логином — это «смотреть любую камеру без входа в систему»: сервису он не нужен
        allowed = body.action == "read" and body.protocol in ("rtsp", "rtsps") and body.path.startswith(video.CAMERA_PREFIX)
        return Response(status_code=_ALLOW if allowed else _DENY)
    if body.action not in ("read", "playback"):
        return Response(status_code=_DENY)
    if body.path.startswith(video.DEMO_PREFIX):
        return Response(status_code=_ALLOW)  # демо-ролики не секрет: их забирает сам шлюз для демо-камер
    token = body.token or parse_qs(body.query).get("token", [""])[0]
    if not token:
        return Response(status_code=_DENY)
    try:
        user = await authenticate(session, token)
    except HTTPException:
        return Response(status_code=_DENY)
    if body.path.startswith(video.PROBE_PREFIX):  # предпросмотр в форме «Добавить камеру»
        return Response(status_code=_ALLOW if user.role in CAMERA_ADDERS else _DENY)
    camera_id = video.camera_id_from_path(body.path)
    camera = await session.get(Camera, camera_id) if camera_id else None
    if camera is None or camera.deleted_at is not None:
        return Response(status_code=_DENY)
    allowed = visible_site_ids(user)
    return Response(status_code=_ALLOW if allowed is None or camera.site_id in allowed else _DENY)


def _live_out(camera_id: str, live: CameraLive | None) -> LiveCameraOut:
    frame = live.frame if live else None
    detections = frame.result.detections if frame else []
    return LiveCameraOut(
        camera_id=camera_id,
        online=bool(live and live.online),
        error=live.error if live else None,
        received_at=live.received_at if live else None,
        analyzed_at=frame.at if frame else None,
        analyzed=frame.result.supported if frame else None,
        note=frame.result.note if frame else None,
        detections=[
            DetectionOut(id=f"live{i}", type=d.type, confidence=d.confidence, box=BoxOut(x=d.x, y=d.y, w=d.w, h=d.h))
            for i, d in enumerate(detections)
        ],
        counts=dict(Counter(d.type for d in detections)),
    )


@router.get("/live", response_model=list[LiveCameraOut], summary="Что видит анализ на каждой камере прямо сейчас")
async def live(user: CurrentUser, session: Session, site_id: SiteIdQuery = None) -> list[LiveCameraOut]:
    query = scope(select(Camera).where(Camera.deleted_at.is_(None), Camera.enabled), Camera.site_id, user, site_id)
    pipeline = get_pipeline()
    return [_live_out(c.id, pipeline.state(c.id)) for c in await session.scalars(query.order_by(Camera.position))]
