"""Встроенная демо-камера: ведёт себя как IP-камера, отдающая снимок по HTTP.

Нужна, чтобы показать добавление камеры по адресу без настоящего оборудования:
    http://127.0.0.1:8100/mock-camera/1/snapshot.jpg          — без пароля
    http://127.0.0.1:8100/mock-camera/secure/1/snapshot.jpg   — с логином и паролем (SK_MOCK_CAMERA_USER / _PASSWORD)
Кадры меняются со временем, как в видеопотоке.
"""

import base64
import hmac
import time
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Response, status

from app.config import get_settings
from app.services.camera_client import mock_frame

settings = get_settings()
router = APIRouter(prefix="/mock-camera", tags=["Демо-камера"])

SCENES: dict[int, tuple[str, list[str]]] = {
    1: ("Земляные работы: экскаватор и самосвал", ["earthworks-loading"]),
    2: ("Бетонирование: два бетоносмесителя", ["foundation-mixers"]),
    3: ("Укладка асфальта: каток", ["road-roller-a", "road-roller-b"]),
    4: ("Въезд: автокран", ["gate-crane"]),
    5: ("Площадка: самосвал и мини-экскаватор", ["gate-dumper"]),
}
_FRAME_SECONDS = 20


def _frame(scene: int) -> Response:
    if not settings.demo_mode or scene not in SCENES:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    playlist = SCENES[scene][1]
    name = playlist[int(time.time() // _FRAME_SECONDS) % len(playlist)]
    return Response(mock_frame(name), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/{scene}/snapshot.jpg", summary="Снимок демо-камеры", response_class=Response)
async def snapshot(scene: int) -> Response:
    return _frame(scene)


@router.get("/secure/{scene}/snapshot.jpg", summary="Снимок демо-камеры с авторизацией", response_class=Response)
async def secure_snapshot(scene: int, authorization: Annotated[str | None, Header()] = None) -> Response:
    expected = base64.b64encode(f"{settings.mock_camera_user}:{settings.mock_camera_password}".encode()).decode()
    given = (authorization or "").removeprefix("Basic ").strip()
    if not hmac.compare_digest(given.encode(), expected.encode()):  # байты: не-ASCII в заголовке не роняет в 500
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, headers={"WWW-Authenticate": 'Basic realm="camera"'})
    return _frame(scene)
