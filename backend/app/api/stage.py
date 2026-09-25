"""Этап по камерам: что ответил сервис этапов — рядом с этапом по графику; кнопка «Определить сейчас»."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_site
from app.config import get_settings
from app.db import utcnow
from app.models import Stage, StageEstimate, User
from app.schemas import SiteStageOut, StageEstimateOut
from app.security import SITE_MANAGERS, CurrentUser, Session
from app.services.engine import local_day
from app.services.stage import estimate

settings = get_settings()
router = APIRouter(tags=["Этап по камерам"])


async def site_stage(session: AsyncSession, site_id: str, user: User) -> SiteStageOut:
    today = local_day(utcnow())
    works = list(
        await session.scalars(
            select(Stage)
            .where(Stage.site_id == site_id, Stage.level == 2, Stage.start_date <= today, Stage.end_date >= today)
            .order_by(Stage.start_date, Stage.position)
        )
    )
    rows = list(
        await session.scalars(
            select(StageEstimate).where(StageEstimate.site_id == site_id).order_by(StageEstimate.at.desc()).limit(50)
        )
    )
    latest = next((r for r in rows if r.error is None), None)
    failed = rows[0] if rows and rows[0].error else None  # последний запрос не удался — это видно даже при старом ответе
    matches = None
    if latest and latest.stage_id and works:
        # по графику сейчас может идти несколько работ; ответ «этап целиком» тоже совпадение
        matches = latest.stage_id in {w.id for w in works} | {w.parent_id for w in works if w.parent_id}
    enabled = bool(settings.stage_url)
    next_at = rows[0].at + timedelta(minutes=settings.stage_interval_min) if enabled and rows else None
    return SiteStageOut(
        enabled=enabled,
        can_run=enabled and user.role in SITE_MANAGERS,
        planned_stage_id=works[0].id if works else None,
        planned_stage_name=works[0].name if works else None,
        latest=StageEstimateOut(
            at=latest.at,
            stage_id=latest.stage_id,
            stage_name=latest.stage_name,
            confidence=latest.confidence,
            reason=latest.reason,
            model=latest.model,
        )
        if latest
        else None,  # fmt: skip
        matches_plan=matches,
        error=failed.error if failed else None,
        error_at=failed.at if failed else None,
        next_at=next_at if next_at and next_at > utcnow() else None,  # просрочен — расписание ждёт свежих кадров
    )


@router.get(
    "/sites/{site_id}/stage-estimate",
    response_model=SiteStageOut,
    summary="Этап по камерам: последний ответ сервиса этапов рядом с этапом по графику",
)
async def get_site_stage(site_id: str, user: CurrentUser, session: Session) -> SiteStageOut:
    await get_site(session, user, site_id)
    return await site_stage(session, site_id, user)


@router.post(
    "/sites/{site_id}/stage-estimate",
    response_model=SiteStageOut,
    summary="Определить этап по камерам сейчас (руководитель, администратор); ответ сервиса — до минуты",
)
async def run_site_stage(site_id: str, user: CurrentUser, session: Session) -> SiteStageOut:
    await get_site(session, user, site_id)
    if user.role not in SITE_MANAGERS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Определять этап вне расписания могут руководитель и администратор")
    if not settings.stage_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Сервис этапов не подключён: задайте SK_STAGE_URL")
    await session.commit()  # закрыть чтение: ответ сохранится другим соединением, а прочитать его нужно свежим
    if await estimate(site_id, trigger="manual") is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нет свежих кадров ни с одной камеры объекта — определять этап не по чему")
    return await site_stage(session, site_id, user)
