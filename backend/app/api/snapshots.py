from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import CameraIdQuery, SiteIdQuery, scope
from app.db import utcnow
from app.models import Snapshot
from app.schemas import SnapshotOut, snapshot_out
from app.security import CurrentUser, Session

router = APIRouter(prefix="/snapshots", tags=["Снимки"])


@router.get("", response_model=list[SnapshotOut], summary="Последние снимки каждой камеры")
async def list_snapshots(
    user: CurrentUser,
    session: Session,
    site_id: SiteIdQuery = None,
    camera_id: CameraIdQuery = None,
    per_camera: Annotated[int, Query(alias="perCamera")] = 8,
) -> list[SnapshotOut]:
    """Возвращает не всю историю, а per_camera свежих снимков на камеру — объём ответа не растёт со временем."""
    per_camera = min(max(per_camera, 1), 50)
    rank = func.row_number().over(partition_by=Snapshot.camera_id, order_by=Snapshot.taken_at.desc()).label("rank")
    ranked = scope(select(Snapshot.id, rank), Snapshot.site_id, user, site_id)
    if camera_id:
        ranked = ranked.where(Snapshot.camera_id == camera_id)
    ranked = ranked.subquery()
    rows = await session.scalars(
        select(Snapshot)
        .where(Snapshot.id.in_(select(ranked.c.id).where(ranked.c.rank <= per_camera)))
        .order_by(Snapshot.taken_at.desc())
    )
    return [snapshot_out(s) for s in rows]


@router.get("/daily", response_model=list[SnapshotOut], summary="«Кадры дня» камер — по одному в день за последние дни")
async def daily_snapshots(
    user: CurrentUser,
    session: Session,
    site_id: SiteIdQuery = None,
    camera_id: CameraIdQuery = None,
    days: Annotated[int, Query(ge=1, le=60)] = 14,
) -> list[SnapshotOut]:
    """Первый кадр каждой камеры после полудня (SK_DAILY_FRAME_HOUR): по ним видно, как меняется площадка день ото дня."""
    query = scope(select(Snapshot), Snapshot.site_id, user, site_id).where(
        Snapshot.daily, Snapshot.taken_at >= utcnow() - timedelta(days=days)
    )
    if camera_id:
        query = query.where(Snapshot.camera_id == camera_id)
    rows = await session.scalars(query.order_by(Snapshot.taken_at.desc()))
    return [snapshot_out(s) for s in rows]
