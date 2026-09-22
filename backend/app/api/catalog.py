"""Объекты, зоны, календарный план, правила, сотрудники, сверка «план / факт» и запуск проверки."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import SiteIdQuery, get_site, scope
from app.db import utcnow
from app.models import CheckRun, Rule, RuleItem, Site, Stage, User, Zone
from app.schemas import (
    CaptureOut,
    CheckRow,
    CheckRunOut,
    EquipmentCheckOut,
    ExtraRow,
    RuleIn,
    RuleOut,
    SiteOut,
    StageOut,
    UserOut,
    ZoneOut,
    check_out,
    rule_out,
    site_out,
    snapshot_out,
    stage_out,
    user_out,
    zone_out,
)
from app.security import CurrentUser, Session, require_roles
from app.services.engine import capture_site, current_stage, local_day, run_check, site_state

router = APIRouter()


@router.get("/sites", response_model=list[SiteOut], tags=["Объекты"], summary="Объекты, доступные пользователю")
async def list_sites(user: CurrentUser, session: Session) -> list[SiteOut]:
    today = local_day(utcnow())
    sites = await session.scalars(scope(select(Site), Site.id, user).order_by(Site.position))
    out = []
    for site in sites:
        stage = await current_stage(session, site.id, today)
        out.append(site_out(site, stage.id if stage else None))
    return out


@router.get("/zones", response_model=list[ZoneOut], tags=["Объекты"], summary="Зоны объектов")
async def list_zones(user: CurrentUser, session: Session, site_id: SiteIdQuery = None) -> list[ZoneOut]:
    rows = await session.scalars(scope(select(Zone), Zone.site_id, user, site_id).order_by(Zone.position, Zone.name))
    return [zone_out(z) for z in rows]


@router.get("/stages", response_model=list[StageOut], tags=["Календарный план"], summary="Этапы календарного плана")
async def list_stages(user: CurrentUser, session: Session, site_id: SiteIdQuery = None) -> list[StageOut]:
    today = local_day(utcnow())
    rows = await session.scalars(scope(select(Stage), Stage.site_id, user, site_id).order_by(Stage.position))
    return [stage_out(s, today) for s in rows]


@router.get("/rules", response_model=list[RuleOut], tags=["Правила"], summary="Методика «этап → техника»")
async def list_rules(_: CurrentUser, session: Session) -> list[RuleOut]:
    return [rule_out(r) for r in await session.scalars(select(Rule).order_by(Rule.position))]


@router.put(
    "/rules/{key}",
    response_model=RuleOut,
    tags=["Правила"],
    summary="Изменить правило (администратор)",
    dependencies=[require_roles("admin")],
)
async def update_rule(key: str, body: RuleIn, session: Session) -> RuleOut:
    rule = await session.get(Rule, key)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Правило не найдено")
    required, unexpected = {r.type for r in body.required}, {u.type for u in body.unexpected}
    if len(required) != len(body.required) or len(unexpected) != len(body.unexpected):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Техника в списке повторяется")
    if required & unexpected:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Одна и та же техника не может быть и нужной, и лишней")

    old = {(i.kind, i.equipment_type): i for i in rule.items}  # сохраняем тексты риска и важность прежних строк
    items, n = [], 0
    for r in body.required:
        prev = old.get(("required", r.type))
        items.append(
            RuleItem(
                kind="required",
                equipment_type=r.type,
                min_count=r.min,
                why=r.why,
                risk=r.risk or (prev.risk if prev else ""),
                severity=prev.severity if prev else None,
                position=(n := n + 1),
            )
        )
    for kind in dict.fromkeys(body.allowed):
        if kind not in required and kind not in unexpected:
            items.append(RuleItem(kind="allowed", equipment_type=kind, position=(n := n + 1)))
    for u in body.unexpected:
        prev = old.get(("unexpected", u.type))
        items.append(
            RuleItem(
                kind="unexpected",
                equipment_type=u.type,
                why=u.why,
                risk=u.risk or (prev.risk if prev else ""),
                severity=prev.severity if prev else None,
                position=(n := n + 1),
            )
        )
    rule.items, rule.confirm_after = items, body.confirm_after_snapshots
    await session.flush()

    # правило изменилось — сразу пересверяем объекты, где сейчас идёт этап с этим правилом
    now, today = utcnow(), local_day(utcnow())
    for site_id in await session.scalars(select(Site.id)):
        stage = await current_stage(session, site_id, today)
        if stage and stage.rule_key == key:
            await run_check(session, site_id, at=now, trigger="rule_change")
    await session.commit()
    await session.refresh(rule)
    return rule_out(rule)


@router.get(
    "/users",
    response_model=list[UserOut],
    tags=["Сотрудники"],
    summary="Сотрудники (администратор)",
    dependencies=[require_roles("admin")],
)
async def list_users(session: Session) -> list[UserOut]:
    return [user_out(u) for u in await session.scalars(select(User).order_by(User.id))]


@router.get(
    "/sites/{site_id}/equipment-check",
    response_model=EquipmentCheckOut,
    tags=["Сверка"],
    summary="План и факт по технике для текущего этапа",
)
async def equipment_check(site_id: str, user: CurrentUser, session: Session) -> EquipmentCheckOut:
    await get_site(session, user, site_id)
    state = await site_state(session, site_id, utcnow())
    rows, extra = [], []
    if state.rule:
        for item in state.rule.of_kind("required"):
            have = state.observed[item.equipment_type]
            rows.append(
                CheckRow(
                    type=item.equipment_type,
                    need=item.min_count,
                    have=have,
                    why=item.why,
                    state="ok" if have >= item.min_count else "missing" if have == 0 else "low",
                )
            )
        seen = state.observed + state.arriving
        extra = [
            ExtraRow(type=i.equipment_type, have=seen[i.equipment_type], why=i.why)
            for i in state.rule.of_kind("unexpected")
            if seen[i.equipment_type]
        ]
    checked_at = max((s.taken_at for s in state.latest.values()), default=None)
    return EquipmentCheckOut(
        site_id=site_id,
        stage_id=state.stage.id if state.stage else None,
        stage_name=state.stage.name if state.stage else None,
        coverage=state.coverage,
        checked_at=checked_at,
        rows=rows,
        extra=extra,
        arriving=dict(state.arriving),
    )


@router.post(
    "/sites/{site_id}/capture",
    response_model=CaptureOut,
    tags=["Сверка"],
    summary="Проверить сейчас: снять кадры со всех камер объекта и сверить с планом",
)
async def capture_now(site_id: str, user: CurrentUser, session: Session) -> CaptureOut:
    await get_site(session, user, site_id)
    report = await capture_site(session, site_id, trigger="manual")
    return CaptureOut(check=check_out(report.check), snapshots=[snapshot_out(s) for s in report.snapshots], errors=report.errors)


@router.get("/sites/{site_id}/checks", response_model=list[CheckRunOut], tags=["Сверка"], summary="Журнал проверок объекта")
async def list_checks(site_id: str, user: CurrentUser, session: Session, limit: int = 20) -> list[CheckRunOut]:
    await get_site(session, user, site_id)
    rows = await session.scalars(
        select(CheckRun).where(CheckRun.site_id == site_id).order_by(CheckRun.at.desc()).limit(min(max(limit, 1), 200))
    )
    return [check_out(c) for c in rows]
