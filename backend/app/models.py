"""Модель данных: пользователи, объекты, камеры, календарный план, правила, кадры, проверки, отклонения, журнал действий."""

import secrets
from datetime import date, datetime

from sqlalchemy import JSON, Column, Date, ForeignKey, Index, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


# Структура таблиц меняется только вместе с миграцией: uv run alembic revision --autogenerate -m "…" (см. alembic.ini)

user_sites = Table(
    "user_sites",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("site_id", ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
)

alert_evidence = Table(
    "alert_evidence",
    Base.metadata,
    Column("alert_id", ForeignKey("alerts.id", ondelete="CASCADE"), primary_key=True),
    Column("snapshot_id", ForeignKey("snapshots.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))  # foreman | manager | inspector | admin
    phone: Mapped[str] = mapped_column(String(32), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)

    sites: Mapped[list["Site"]] = relationship(secondary=user_sites, lazy="selectin")


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(String(200), default="")
    contractor: Mapped[str] = mapped_column(String(200), default="")
    foreman_name: Mapped[str] = mapped_column(String(120), default="")
    position: Mapped[int] = mapped_column(default=0)
    # выполнение объекта не хранится: его считают по календарному плану (services/plan.py)


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # work — рабочая зона (техника считается работающей), gate — въезд (техника «подъезжает»), storage — склад
    kind: Mapped[str] = mapped_column(String(16), default="work")
    position: Mapped[int] = mapped_column(default=0)


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"))
    name: Mapped[str] = mapped_column(String(200))

    # Источник — всегда видеопоток RTSP: его забирает шлюз видео. Демо-камеры смотрят на демо-ролики в том же шлюзе.
    source_type: Mapped[str] = mapped_column(String(8), default="rtsp")
    scheme: Mapped[str | None] = mapped_column(String(8), default="rtsp")
    host: Mapped[str | None] = mapped_column(String(255))
    port: Mapped[int | None]
    path: Mapped[str | None] = mapped_column(String(500))
    username: Mapped[str | None] = mapped_column(String(120))
    password_enc: Mapped[str | None] = mapped_column(Text)  # зашифрован, наружу не отдаётся
    scene: Mapped[str] = mapped_column(String(16), default="yard")  # фон-заглушка, пока видео не пришло

    enabled: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(String(10), default="unknown")  # online | offline | unknown
    last_error: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_snapshot_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    position: Mapped[int] = mapped_column(default=0)

    zone: Mapped[Zone] = relationship(lazy="joined")


class Rule(Base):
    """Правило методики: «этап работ → необходимая техника»."""

    __tablename__ = "rules"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    stage_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    confirm_after: Mapped[int] = mapped_column(default=3)  # сколько проверок подряд подтверждают отклонение
    position: Mapped[int] = mapped_column(default=0)

    items: Mapped[list["RuleItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin", order_by="RuleItem.position")

    def of_kind(self, kind: str) -> list["RuleItem"]:
        return [i for i in self.items if i.kind == kind]


class RuleItem(Base):
    __tablename__ = "rule_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    rule_key: Mapped[str] = mapped_column(ForeignKey("rules.key", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # required | allowed | unexpected
    equipment_type: Mapped[str] = mapped_column(String(20))
    min_count: Mapped[int] = mapped_column(default=1)
    why: Mapped[str] = mapped_column(Text, default="")  # зачем техника нужна / почему она лишняя
    risk: Mapped[str] = mapped_column(Text, default="")  # чем грозит отклонение — попадает в текст предупреждения
    severity: Mapped[str | None] = mapped_column(String(8))  # переопределяет важность по умолчанию
    position: Mapped[int] = mapped_column(default=0)


class Stage(Base):
    """Этап календарного плана. Уровень 1 — укрупнённый, уровень 2 — работы, к которым привязано правило."""

    __tablename__ = "stages"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("stages.id"))
    level: Mapped[int] = mapped_column(default=2)
    name: Mapped[str] = mapped_column(String(200))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    rule_key: Mapped[str | None] = mapped_column(ForeignKey("rules.key"))
    position: Mapped[int] = mapped_column(default=0)
    # сколько сделано по факту, % — отмечают прораб, руководитель и администратор; у этапа с работами считается по работам
    fact_progress: Mapped[int] = mapped_column(default=0, server_default="0")
    fact_updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    def status_on(self, day: date) -> str:
        if day > self.end_date:
            return "done"
        return "in_progress" if day >= self.start_date else "planned"

    def plan_progress_on(self, day: date) -> int:
        """Сколько процентов должно быть сделано к концу этого дня по графику — равномерно по дням этапа."""
        if day < self.start_date:
            return 0
        total = (self.end_date - self.start_date).days + 1
        return min(100, round(((day - self.start_date).days + 1) * 100 / total))


class CheckRun(Base):
    """Проверка объекта: что увидели камеры и какие отклонения от правила этапа найдены."""

    __tablename__ = "check_runs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(UTCDateTime)
    trigger: Mapped[str] = mapped_column(String(16))  # schedule | manual | seed | ingest | camera_added | rule_change
    stage_id: Mapped[str | None] = mapped_column(ForeignKey("stages.id"))
    coverage: Mapped[bool] = mapped_column(default=True)  # есть ли свежий кадр рабочей зоны
    observed: Mapped[dict] = mapped_column(JSON, default=dict)  # техника в рабочих зонах: {тип: количество}
    arriving: Mapped[dict] = mapped_column(JSON, default=dict)  # техника на въезде и складе
    violations: Mapped[list] = mapped_column(JSON, default=list)

    __table_args__ = (Index("ix_check_runs_site_at", "site_id", "at"),)


class Snapshot(Base):
    __tablename__ = "snapshots"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"))
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    check_id: Mapped[str | None] = mapped_column(ForeignKey("check_runs.id", ondelete="SET NULL"))
    taken_at: Mapped[datetime] = mapped_column(UTCDateTime)
    image_url: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(10), default="capture")  # seed | capture | ingest
    analyzed: Mapped[bool] = mapped_column(default=True)  # False — анализ не удался или кадр незнаком демо-анализатору
    provider: Mapped[str | None] = mapped_column(String(40))
    analysis_ms: Mapped[int | None]
    note: Mapped[str | None] = mapped_column(Text)

    detections: Mapped[list["Detection"]] = relationship(cascade="all, delete-orphan", lazy="selectin", order_by="Detection.id")

    __table_args__ = (
        Index("ix_snapshots_camera_taken", "camera_id", "taken_at"),
        Index("ix_snapshots_site_taken", "site_id", "taken_at"),
    )


class Detection(Base):
    """Единица техники на снимке. Рамка — в процентах от кадра 16:9, начало координат слева сверху."""

    __tablename__ = "detections"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("snapshots.id", ondelete="CASCADE"), index=True)
    equipment_type: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float]
    x: Mapped[float]
    y: Mapped[float]
    w: Mapped[float]
    h: Mapped[float]
    moving: Mapped[bool | None]  # сдвинулась ли техника относительно предыдущего кадра этой камеры


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    number: Mapped[int] = mapped_column(unique=True)  # сквозной номер для журнала: ОТК-26-0137
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"))
    stage_id: Mapped[str | None] = mapped_column(ForeignKey("stages.id"))
    camera_id: Mapped[str | None] = mapped_column(ForeignKey("cameras.id"))

    kind: Mapped[str] = mapped_column(String(16))  # missing | count_below | unexpected | idle | camera_offline
    severity: Mapped[str] = mapped_column(String(8))  # high | medium | low
    status: Mapped[str] = mapped_column(String(16), default="new")
    equipment_type: Mapped[str | None] = mapped_column(String(20))
    expected: Mapped[int | None]
    observed: Mapped[int | None]

    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    consequence: Mapped[str] = mapped_column(Text, default="")
    advice: Mapped[str] = mapped_column(Text, default="")
    prescription_no: Mapped[str | None] = mapped_column(String(20))

    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    cleared_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # условие перестало наблюдаться
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    evidence: Mapped[list[Snapshot]] = relationship(secondary=alert_evidence, lazy="selectin", order_by="Snapshot.taken_at")
    events: Mapped[list["AlertEvent"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="AlertEvent.at, AlertEvent.id"
    )

    __table_args__ = (Index("ix_alerts_site_status", "site_id", "status"),)


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    who: Mapped[str] = mapped_column(String(160))
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(String(16))  # статус, установленный этим событием


class AuditEvent(Base):
    """Журнал действий: кто, когда и что сделал в системе (добавил камеру, сменил пароль, закрыл отклонение…)."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    # кто — копией, а не ссылкой: запись должна пережить удаление пользователя
    actor_id: Mapped[str | None] = mapped_column(String(40))
    actor_login: Mapped[str] = mapped_column(String(120), default="")
    actor_name: Mapped[str] = mapped_column(String(160), default="")
    actor_role: Mapped[str] = mapped_column(String(20), default="")
    action: Mapped[str] = mapped_column(String(40), index=True)  # camera.delete, user.password, login.failed…
    entity_type: Mapped[str] = mapped_column(String(20), default="")  # camera | site | user | rule | alert | stage | zone
    entity_id: Mapped[str | None] = mapped_column(String(40))
    entity_name: Mapped[str] = mapped_column(String(300), default="")
    summary: Mapped[str] = mapped_column(Text)  # по-человечески: «Удалил камеру «Камера 2 — въезд» (Школа на 550 мест)»
    details: Mapped[dict] = mapped_column(JSON, default=dict)  # что именно поменялось: {"поле": [было, стало]}
    ip: Mapped[str] = mapped_column(String(64), default="")


OPEN_STATUSES = ("new", "acknowledged", "confirmed", "prescribed")
