"""Работы по камерам: что ответили сервисы аналитики по кадрам — рядом с графиком; «Определить сейчас»; справочник
видов работ для плана."""

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SiteIdQuery, get_site
from app.config import get_settings
from app.db import utcnow
from app.models import AnalyticsRequest, AnalyticsResult, Camera, Site, Snapshot, Stage, User
from app.schemas import (
    AnalyticsCatalogOut,
    CameraWorkOut,
    CatalogWorkOut,
    ScheduleItemOut,
    ScheduleOut,
    ServiceAnswerOut,
    SiteWorkOut,
    TransitionOut,
    WorkEvidenceOut,
    WorkGroupOut,
    WorkRefOut,
)
from app.security import SITE_MANAGERS, CurrentUser, Session
from app.services.analytics.catalog import Catalog, CatalogError, object_type
from app.services.analytics.request import plan_problem, plan_works
from app.services.analytics.runner import fresh_snapshot, get_analytics, work_cameras
from app.services.engine import local_day

router = APIRouter(tags=["Работы по камерам"])
RECENT = 10  # сколько последних отправок камеры просматривать в поисках готового ответа
EVIDENCE = 6


def _seconds(value: object) -> int | None:
    """overdue_seconds — число (у сервиса коллеги дробное: 857392.682) или null."""
    return round(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _moment(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


class _Names:
    """step_key ответа → наша работа (или вид работ справочника, если работу уже удалили из плана)."""

    def __init__(self, works: list[Stage], catalog: Catalog | None) -> None:
        self.works, self.catalog = {w.id: w for w in works}, catalog

    def ref(self, step_key: str, stage_id: int | None = None) -> WorkRefOut:
        work = self.works.get(step_key)
        stage_id = stage_id if stage_id is not None else (work.catalog_stage_id if work else None)
        if work:
            name = work.name
        elif self.catalog and stage_id in self.catalog.works:
            name = self.catalog.works[stage_id].name
        else:
            name = "работа удалена из плана"
        return WorkRefOut(step_key=step_key, stage_id=stage_id, name=name, in_plan=work is not None)


def _model(result: dict) -> str | None:
    versions = result.get("versions") or {}
    parts = [versions.get("service_version")]
    if versions.get("vision_model") or versions.get("llm_model"):
        parts.append(" → ".join(v for v in (versions.get("vision_model"), versions.get("llm_model")) if v))
    if versions.get("matrix_version"):
        parts.append(f"матрица {versions['matrix_version']}")
    text = ", ".join(p for p in parts if p)
    return text[:160] or None


def _answer(
    service: str, request: AnalyticsRequest | None, row: AnalyticsResult | None, names: _Names, newer_pending: bool
) -> ServiceAnswerOut:
    answer = ServiceAnswerOut(
        service=service,
        state=row.state if row else "pending",
        at=row.finished_at if row else None,
        observed_at=request.observed_at if request else None,
        outcome=None,
        groups=[],
        transition=None,
        schedule=None,
        limitations=[],
        model=None,
        error_code=row.error_code if row else None,
        error=row.error if row else None,
        newer_pending=newer_pending,
    )
    if row is None or row.state != "done" or not row.result:
        return answer
    result = row.result
    answer.outcome, answer.model = row.outcome, _model(result)
    answer.limitations = [str(item)[:1000] for item in result.get("limitations") or []][:20]
    for group in result["current_work"]["work_groups"]:
        answer.groups.append(
            WorkGroupOut(
                match=str(group.get("match_status") or ""),
                works=[names.ref(c["step_key"], c["stage_id"]) for c in group["candidates"]],
                visual_state=str(group.get("visual_state") or ""),
                explanation=str(group.get("explanation") or ""),
                evidence=[
                    WorkEvidenceOut(
                        source=str(e.get("source")), role=str(e.get("role")), explanation=str(e.get("explanation") or "")
                    )
                    for e in (group.get("evidence") or [])[:EVIDENCE]
                    if isinstance(e, dict)
                ],
                area=group.get("area_bbox") if isinstance(group.get("area_bbox"), list) else None,
            )
        )
    transition = result["transition"]
    if transition.get("status") != "not_evaluated":
        answer.transition = TransitionOut(
            status=transition["status"],
            current=names.ref(transition["current_step_key"]) if transition.get("current_step_key") else None,
            next=names.ref(transition["next_step_key"]) if transition.get("next_step_key") else None,
            first_at=_moment(transition.get("evidence_first_at")),
            last_at=_moment(transition.get("evidence_last_at")),
            points=int(transition.get("supporting_observations") or 0),
        )
    schedule = result["schedule"]
    if schedule.get("status") != "not_evaluated":
        answer.schedule = ScheduleOut(
            status=schedule["status"],
            items=[
                ScheduleItemOut(
                    work=names.ref(item["step_key"], item.get("stage_id")),
                    status=str(item.get("status")),
                    reason=str(item.get("reason_code")),
                    overdue_s=_seconds(item.get("overdue_seconds")),
                    evidence_at=_moment(item.get("evidence_at")),
                )
                for item in schedule.get("items") or []
                if isinstance(item, dict) and item.get("step_key")
            ],
        )
    return answer


async def _camera(session: AsyncSession, camera: Camera, services: list[str], names: _Names, planned: set[str]) -> CameraWorkOut:
    requests = list(
        await session.scalars(
            select(AnalyticsRequest)
            .where(AnalyticsRequest.camera_id == camera.id)
            .order_by(AnalyticsRequest.at.desc())
            .limit(RECENT)
        )
    )
    answers, frames = [], []
    for service in services:
        newer_pending, shown = False, None
        for request in requests:  # от свежих к старым: ответ, который уже пришёл; более свежий, который ждём, — отметкой
            row = next((r for r in request.results if r.service == service), None)
            if row is None:
                continue
            if row.state == "pending":
                newer_pending = True
                continue
            shown = (request, row)
            break
        if shown:
            answers.append(_answer(service, *shown, names, newer_pending))
            frames.append(shown[0])
        elif newer_pending:
            answers.append(_answer(service, requests[0], None, names, True))
    frame = frames[0] if frames else requests[0] if requests else None  # кадр, о котором первый показанный ответ
    snapshot = await session.get(Snapshot, frame.snapshot_id) if frame and frame.snapshot_id else None
    candidates = {w.step_key for a in answers if a.outcome == "assessed" for g in a.groups for w in g.works}
    assessed = any(a.outcome == "assessed" for a in answers)
    return CameraWorkOut(
        camera_id=camera.id,
        camera_name=camera.name,
        zone_name=camera.zone.name,
        sent_at=requests[0].at if requests else None,
        image_url=snapshot.image_url if snapshot else None,
        answers=answers,
        matches_plan=bool(candidates & planned) if assessed and planned else None,
    )


async def site_work(session: AsyncSession, site: Site, user: User) -> SiteWorkOut:
    """Технические причины (адреса сервисов, коды отказов) — руководителю и администратору; остальным — только суть."""
    analytics, settings = get_analytics(), get_settings()
    managers = user.role in SITE_MANAGERS
    services = list(analytics.clients)
    catalog = analytics.catalog.peek() if analytics.enabled else None
    works = await plan_works(session, site.id)
    today = local_day(utcnow())
    planned = [w for w in works if w.start_date <= today <= w.end_date]
    cameras = await work_cameras(session, site.id)
    names = _Names(works, catalog)
    blocks = [await _camera(session, camera, services, names, {w.id for w in planned}) for camera in cameras]
    if not managers:
        for answer in (a for block in blocks for a in block.answers):
            answer.error = None
    sent = [b.sent_at for b in blocks if b.sent_at]
    # камеру, по которой ещё не отправляли, расписание возьмёт в ближайшую минуту — срока не показываем
    next_at = min(sent) + timedelta(minutes=settings.analytics_interval_min) if sent and len(sent) == len(blocks) else None
    problem = analytics.problems.get(site.id)
    plan_issue = plan_problem(works, catalog, site.kind) if analytics.enabled else None
    return SiteWorkOut(
        enabled=analytics.enabled,
        services=services,
        can_run=analytics.enabled and managers,
        running=analytics.running(site.id),
        planned=[w.name for w in planned],
        plan_issue=plan_issue if managers or not plan_issue else "план не сопоставлен со справочником сервисов",
        problem=problem[1] if problem and managers else None,
        cameras=blocks,
        catalog_version=catalog.version if catalog else None,
        next_at=next_at if next_at and next_at > utcnow() else None,  # просрочено — расписание ждёт свежих кадров
    )


@router.get(
    "/sites/{site_id}/work-analysis",
    response_model=SiteWorkOut,
    summary="Работы по камерам: последние ответы сервисов аналитики по кадрам камер рабочих зон",
)
async def get_site_work(site_id: str, user: CurrentUser, session: Session) -> SiteWorkOut:
    site = await get_site(session, user, site_id)
    return await site_work(session, site, user)


@router.post(
    "/sites/{site_id}/work-analysis",
    response_model=SiteWorkOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Отправить свежие кадры объекта сервисам аналитики сейчас (руководитель, администратор); ответ — в фоне",
)
async def run_site_work(site_id: str, user: CurrentUser, session: Session) -> SiteWorkOut:
    site = await get_site(session, user, site_id)
    if user.role not in SITE_MANAGERS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Отправлять кадры вне расписания могут руководитель и администратор")
    analytics = get_analytics()
    if not analytics.enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Сервисы аналитики не подключены: задайте DETERMINISTIC_SERVICE_URL и/или VLM_LLM_SERVICE_URL",
        )
    cameras = await work_cameras(session, site.id)
    if not cameras:
        raise HTTPException(status.HTTP_409_CONFLICT, "На объекте нет камер рабочих зон — сервисам нечего отправлять")
    now = utcnow()
    if not [c for c in cameras if await fresh_snapshot(session, c.id, now)]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нет свежих кадров с камер рабочих зон — отправлять нечего")
    analytics.start_site(site.id)  # уже идёт — просто покажем, что идёт
    return await site_work(session, site, user)


@router.get(
    "/analytics/catalog",
    response_model=AnalyticsCatalogOut,
    summary="Виды работ из справочника сервисов аналитики — для сопоставления с работами плана",
)
async def analytics_catalog(user: CurrentUser, session: Session, site_id: SiteIdQuery = None) -> AnalyticsCatalogOut:
    if user.role not in SITE_MANAGERS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Справочник нужен тем, кто ведёт план: руководителю и администратору")
    kind = object_type((await get_site(session, user, site_id)).kind) if site_id else None
    analytics = get_analytics()
    empty = AnalyticsCatalogOut(enabled=analytics.enabled, version=None, object_type=kind, works=[], error=None)
    if not analytics.enabled:
        return empty
    try:
        catalog = await analytics.catalog.get()
    except CatalogError as exc:
        return empty.model_copy(update={"error": f"справочник не получен: {exc}"})
    works = [
        CatalogWorkOut(
            stage_id=w.stage_id,
            name=w.name,
            path=list(w.path[:-1] if w.path and w.path[-1] == w.name else w.path),
            kind=w.kind,
        )
        for w in catalog.works_for(kind)
    ]
    error = f"сервисы не ответили, показан сохранённый справочник: {analytics.catalog.error}" if analytics.catalog.error else None
    return AnalyticsCatalogOut(enabled=True, version=catalog.version, object_type=kind, works=works, error=error)
