"""Предупреждения об отклонениях: лента, карточка, ответы пользователей."""

import re

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import SiteIdQuery, scope
from app.db import utcnow
from app.models import OPEN_STATUSES, Alert, AlertEvent, User
from app.schemas import AlertActionIn, AlertOut, alert_out
from app.security import CurrentUser, Session, ensure_site_access

router = APIRouter(prefix="/alerts", tags=["Отклонения"])

ROLE_TITLES = {"foreman": "прораб", "manager": "руководитель проекта", "inspector": "инспектор", "admin": "администратор"}

# Кто и из какого статуса может перевести предупреждение в новый статус
TRANSITIONS: dict[str, dict[str, set[str]]] = {
    "foreman": {
        "acknowledged": {"new"},
        "confirmed": {"new"},
        "resolved": {"acknowledged", "confirmed"},
        "false_positive": {"new", "acknowledged", "confirmed"},
    },
    "manager": {
        "confirmed": {"new"},
        "resolved": {"new", "acknowledged", "confirmed"},
        "false_positive": {"new", "acknowledged", "confirmed"},
    },
    "inspector": {
        "prescribed": {"new", "acknowledged", "confirmed"},
        "resolved": set(OPEN_STATUSES),
        "false_positive": set(OPEN_STATUSES),
    },
}
DEFAULT_COMMENTS = {
    "acknowledged": "Техника уже едет, проблема будет решена.",
    "confirmed": "Подтверждаю: проблема есть, разбираемся.",
    "resolved": "Проблема устранена.",
    "false_positive": "Система ошиблась, на месте всё в порядке.",
    "prescribed": "обеспечить соответствие техники графику работ.",
}


async def _next_prescription(session) -> str:  # noqa: ANN001
    numbers = [
        int(m.group(1))
        for no in await session.scalars(select(Alert.prescription_no).where(Alert.prescription_no.is_not(None)))
        if (m := re.match(r"(\d+)", no))
    ]
    return f"{max(numbers, default=100) + 1}-П"


@router.get("", response_model=list[AlertOut], summary="Предупреждения по доступным объектам")
async def list_alerts(
    user: CurrentUser, session: Session, site_id: SiteIdQuery = None, state: str = "all", limit: int = 200
) -> list[AlertOut]:
    query = scope(select(Alert), Alert.site_id, user, site_id)
    if state == "open":
        query = query.where(Alert.status.in_(OPEN_STATUSES))
    elif state == "closed":
        query = query.where(Alert.status.not_in(OPEN_STATUSES))
    rows = await session.scalars(query.order_by(Alert.started_at.desc()).limit(min(max(limit, 1), 500)))
    return [alert_out(a) for a in rows]


async def _get(session, user: User, alert_id: str) -> Alert:  # noqa: ANN001
    alert = await session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Предупреждение не найдено")
    ensure_site_access(user, alert.site_id)
    return alert


@router.get("/{alert_id}", response_model=AlertOut, summary="Карточка предупреждения")
async def get_alert(alert_id: str, user: CurrentUser, session: Session) -> AlertOut:
    return alert_out(await _get(session, user, alert_id))


@router.post("/{alert_id}/actions", response_model=AlertOut, summary="Ответить на предупреждение (сменить статус)")
async def act(alert_id: str, body: AlertActionIn, user: CurrentUser, session: Session) -> AlertOut:
    alert = await _get(session, user, alert_id)
    allowed_from = TRANSITIONS.get(user.role, {}).get(body.status)
    if allowed_from is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Для вашей роли это действие недоступно")
    if alert.status == "prescribed" and user.role != "inspector":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "По этому отклонению выдано предписание — закрыть его может только инспектор"
        )
    if alert.status not in allowed_from:
        raise HTTPException(status.HTTP_409_CONFLICT, "Статус предупреждения уже изменился. Обновите страницу.")

    now, comment = utcnow(), body.comment.strip()
    if body.status == "prescribed":
        alert.prescription_no = await _next_prescription(session)
        comment = f"Выдано предписание № {alert.prescription_no}: {comment or DEFAULT_COMMENTS['prescribed']}"
    alert.status, alert.updated_at = body.status, now
    if body.status in ("resolved", "false_positive"):
        alert.resolved_at = now
    alert.events.append(
        AlertEvent(
            at=now,
            who=f"{user.name} ({ROLE_TITLES[user.role]})",
            status=body.status,
            text=comment or DEFAULT_COMMENTS[body.status],
        )
    )
    await session.commit()
    await session.refresh(alert)
    return alert_out(alert)
