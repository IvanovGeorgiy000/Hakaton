"""Камеры: список, добавление по IP-адресу с проверкой подключения, включение/выключение, удаление, ручная съёмка."""

import base64

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import SiteIdQuery, get_camera, get_site, scope
from app.db import utcnow
from app.models import Camera, Zone, new_id
from app.schemas import CameraIn, CameraOut, CameraPatch, CaptureOut, ConnectionIn, ProbeOut, camera_out, check_out, snapshot_out
from app.security import CurrentUser, Session, encrypt_secret, require_roles
from app.services.camera_client import DEFAULT_PORTS, CameraAddress, CameraError, probe, validate_address
from app.services.engine import capture_site

router = APIRouter(prefix="/cameras", tags=["Камеры"])
admin_only = [require_roles("admin")]


def _address(conn: ConnectionIn) -> CameraAddress:
    host = conn.host.strip().strip("[]")
    path = conn.path.strip() or "/"
    addr = CameraAddress(
        scheme=conn.protocol,
        host=host,
        port=conn.port or DEFAULT_PORTS[conn.protocol],
        path=path if path.startswith("/") else f"/{path}",
        username=(conn.username or "").strip() or None,
        password=conn.password or None,
    )
    try:
        validate_address(addr)
    except CameraError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.message) from None
    return addr


def _probe_out(result) -> ProbeOut:  # noqa: ANN001
    preview = f"data:image/jpeg;base64,{base64.b64encode(result.frame).decode()}" if result.frame else None
    return ProbeOut(ok=result.ok, code=result.code, message=result.message, elapsed_ms=result.elapsed_ms, preview=preview)


@router.get("", response_model=list[CameraOut], summary="Камеры доступных объектов")
async def list_cameras(user: CurrentUser, session: Session, site_id: SiteIdQuery = None) -> list[CameraOut]:
    query = scope(select(Camera).where(Camera.deleted_at.is_(None)), Camera.site_id, user, site_id)
    return [camera_out(c) for c in await session.scalars(query.order_by(Camera.site_id, Camera.position, Camera.created_at))]


@router.post(
    "/probe", response_model=ProbeOut, dependencies=admin_only, summary="Проверить подключение к камере по адресу, не сохраняя её"
)
async def probe_camera(conn: ConnectionIn) -> ProbeOut:
    return _probe_out(await probe(_address(conn)))


@router.post(
    "",
    response_model=CameraOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=admin_only,
    summary="Добавить камеру по IP-адресу",
)
async def add_camera(body: CameraIn, user: CurrentUser, session: Session) -> CameraOut:
    await get_site(session, user, body.site_id)
    addr = _address(body.connection)

    duplicate = await session.scalar(
        select(Camera.id).where(
            Camera.deleted_at.is_(None), Camera.host == addr.host, Camera.port == addr.port, Camera.path == addr.path
        )
    )
    if duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT, "Камера с таким адресом уже добавлена")

    result = await probe(addr)
    if not result.ok and not body.allow_offline:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, result.message)

    if body.zone_id:
        zone = await session.get(Zone, body.zone_id)
        if zone is None or zone.site_id != body.site_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Зона не относится к этому объекту")
    elif body.new_zone_name and body.new_zone_name.strip():
        zone = Zone(id=new_id("z"), site_id=body.site_id, name=body.new_zone_name.strip(), kind=body.new_zone_kind, position=100)
        session.add(zone)
        await session.flush()
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Выберите зону или введите название новой")

    position = (await session.scalar(select(func.max(Camera.position)).where(Camera.site_id == body.site_id)) or 0) + 1
    camera = Camera(
        id=new_id("cam"),
        site_id=body.site_id,
        zone_id=zone.id,
        name=body.name.strip(),
        source_type="rtsp" if addr.scheme == "rtsp" else "http",
        scheme=addr.scheme,
        host=addr.host,
        port=addr.port,
        path=addr.path,
        username=addr.username,
        password_enc=encrypt_secret(addr.password) if addr.password else None,
        status="online" if result.ok else "offline",
        last_error=None if result.ok else result.message,
        last_seen_at=utcnow() if result.ok else None,
        position=position,
    )
    session.add(camera)
    await session.commit()

    if result.ok:  # сразу снимаем первый кадр, чтобы камера появилась в интерфейсе не пустой
        await capture_site(session, body.site_id, trigger="camera_added", only_camera=camera.id)
    await session.refresh(camera)
    return camera_out(camera)


@router.patch("/{camera_id}", response_model=CameraOut, dependencies=admin_only, summary="Переименовать, включить или выключить")
async def patch_camera(camera_id: str, body: CameraPatch, user: CurrentUser, session: Session) -> CameraOut:
    camera = await get_camera(session, user, camera_id)
    if body.name is not None:
        camera.name = body.name.strip()
    if body.enabled is not None:
        camera.enabled = body.enabled
    if body.zone_id is not None:
        zone = await session.get(Zone, body.zone_id)
        if zone is None or zone.site_id != camera.site_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Зона не относится к этому объекту")
        camera.zone_id = zone.id
    await session.commit()
    await session.refresh(camera)
    return camera_out(camera)


@router.delete(
    "/{camera_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=admin_only,
    summary="Удалить камеру (снимки-доказательства сохраняются)",
)
async def delete_camera(camera_id: str, user: CurrentUser, session: Session) -> None:
    camera = await get_camera(session, user, camera_id)
    camera.deleted_at, camera.enabled = utcnow(), False
    await session.commit()


@router.post(
    "/{camera_id}/test", response_model=ProbeOut, dependencies=admin_only, summary="Проверить связь с уже добавленной камерой"
)
async def test_camera(camera_id: str, user: CurrentUser, session: Session) -> ProbeOut:
    from app.services.engine import camera_address

    camera = await get_camera(session, user, camera_id)
    if camera.source_type == "mock":
        ok = not camera.mock_fail
        return ProbeOut(
            ok=ok,
            code="ok" if ok else "unreachable",
            elapsed_ms=0,
            message="Демонстрационная камера отвечает" if ok else "Камера не отвечает: нет сигнала",
        )
    return _probe_out(await probe(camera_address(camera)))


@router.post("/{camera_id}/capture", response_model=CaptureOut, summary="Снять кадр с одной камеры и пересверить объект")
async def capture_one(camera_id: str, user: CurrentUser, session: Session) -> CaptureOut:
    camera = await get_camera(session, user, camera_id)
    report = await capture_site(session, camera.site_id, trigger="manual", only_camera=camera.id)
    return CaptureOut(check=check_out(report.check), snapshots=[snapshot_out(s) for s in report.snapshots], errors=report.errors)
