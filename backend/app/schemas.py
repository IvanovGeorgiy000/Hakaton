"""Схемы API. JSON — в camelCase и совпадает с типами фронтенда (frontend/src/data/types.ts)."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.equipment import EQUIPMENT_TYPES
from app.models import OPEN_STATUSES, Alert, Camera, CheckRun, Rule, Site, Snapshot, Stage, User, Zone
from app.services.camera_client import CameraAddress

EquipmentType = Literal["excavator", "dump_truck", "roller", "manipulator", "mixer", "bulldozer", "truck", "crane"]
RoleId = Literal["foreman", "manager", "inspector", "admin"]
assert set(EquipmentType.__args__) == set(EQUIPMENT_TYPES)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- доступ ----------
class LoginIn(ApiModel):
    login: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class DemoLoginIn(ApiModel):
    role: RoleId


class UserOut(ApiModel):
    id: str
    login: str
    name: str
    role: RoleId
    phone: str
    site_ids: list[str]


class TokenOut(ApiModel):
    token: str
    user: UserOut


def user_out(u: User) -> UserOut:
    return UserOut(id=u.id, login=u.login, name=u.name, role=u.role, phone=u.phone, site_ids=[s.id for s in u.sites])


# ---------- объекты ----------
class SiteOut(ApiModel):
    id: str
    name: str
    address: str
    contractor: str
    foreman: str
    current_stage_id: str | None
    plan_progress: int
    fact_progress: int


def site_out(s: Site, current_stage_id: str | None) -> SiteOut:
    return SiteOut(
        id=s.id,
        name=s.name,
        address=s.address,
        contractor=s.contractor,
        foreman=s.foreman_name,
        current_stage_id=current_stage_id,
        plan_progress=s.plan_progress,
        fact_progress=s.fact_progress,
    )


class ZoneOut(ApiModel):
    id: str
    site_id: str
    name: str
    kind: Literal["work", "gate", "storage"]


def zone_out(z: Zone) -> ZoneOut:
    return ZoneOut(id=z.id, site_id=z.site_id, name=z.name, kind=z.kind)


class StageOut(ApiModel):
    id: str
    site_id: str
    parent_id: str | None
    level: int
    name: str
    start: date
    end: date
    status: Literal["done", "in_progress", "planned"]
    rule_key: str | None


def stage_out(s: Stage, today: date) -> StageOut:
    return StageOut(
        id=s.id,
        site_id=s.site_id,
        parent_id=s.parent_id,
        level=s.level,
        name=s.name,
        start=s.start_date,
        end=s.end_date,
        status=s.status_on(today),
        rule_key=s.rule_key,
    )


# ---------- правила ----------
class RuleRequirement(ApiModel):
    type: EquipmentType
    min: int = Field(ge=1, le=50)
    why: str = ""
    risk: str = ""


class RuleUnexpected(ApiModel):
    type: EquipmentType
    why: str = ""
    risk: str = ""


class RuleOut(ApiModel):
    key: str
    stage_name: str
    description: str
    required: list[RuleRequirement]
    allowed: list[EquipmentType]
    unexpected: list[RuleUnexpected]
    confirm_after_snapshots: int


class RuleIn(ApiModel):
    required: list[RuleRequirement]
    allowed: list[EquipmentType] = []
    unexpected: list[RuleUnexpected] = []
    confirm_after_snapshots: int = Field(ge=1, le=24)


def rule_out(r: Rule) -> RuleOut:
    return RuleOut(
        key=r.key,
        stage_name=r.stage_name,
        description=r.description,
        confirm_after_snapshots=r.confirm_after,
        required=[RuleRequirement(type=i.equipment_type, min=i.min_count, why=i.why, risk=i.risk) for i in r.of_kind("required")],
        allowed=[i.equipment_type for i in r.of_kind("allowed")],
        unexpected=[RuleUnexpected(type=i.equipment_type, why=i.why, risk=i.risk) for i in r.of_kind("unexpected")],
    )


# ---------- камеры ----------
class CameraOut(ApiModel):
    id: str
    site_id: str
    zone_id: str
    name: str
    online: bool  # включена и на связи
    enabled: bool
    status: Literal["online", "offline", "unknown"]
    source_type: Literal["mock", "http", "rtsp"]
    address: str | None  # без логина и пароля
    has_credentials: bool
    last_error: str | None
    last_snapshot_at: datetime | None
    scene: str


def camera_out(c: Camera) -> CameraOut:
    address = None
    if c.source_type != "mock" and c.host:
        address = CameraAddress(c.scheme or "http", c.host, c.port or 80, c.path or "/").display
    return CameraOut(
        id=c.id,
        site_id=c.site_id,
        zone_id=c.zone_id,
        name=c.name,
        enabled=c.enabled,
        status=c.status,
        online=c.enabled and c.status != "offline",
        source_type=c.source_type,
        address=address,
        has_credentials=bool(c.username),
        last_error=c.last_error,
        last_snapshot_at=c.last_snapshot_at,
        scene=c.scene,
    )


class ConnectionIn(ApiModel):
    protocol: Literal["http", "https", "rtsp"] = "http"
    host: str = Field(min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    path: str = Field(default="/", max_length=500)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=200)


class CameraIn(ApiModel):
    site_id: str
    name: str = Field(min_length=2, max_length=200)
    zone_id: str | None = None
    new_zone_name: str | None = Field(default=None, max_length=200)  # создать зону, если подходящей нет
    new_zone_kind: Literal["work", "gate", "storage"] = "work"
    connection: ConnectionIn
    allow_offline: bool = False  # сохранить, даже если камера сейчас не отвечает


class CameraPatch(ApiModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    enabled: bool | None = None
    zone_id: str | None = None


class ProbeOut(ApiModel):
    ok: bool
    code: str
    message: str
    elapsed_ms: int
    preview: str | None = None  # data:image/jpeg;base64,… — кадр для предпросмотра


# ---------- снимки ----------
class BoxOut(ApiModel):
    x: float
    y: float
    w: float
    h: float


class DetectionOut(ApiModel):
    id: str
    type: EquipmentType
    confidence: float
    box: BoxOut
    moving: bool | None = None


class SnapshotOut(ApiModel):
    id: str
    camera_id: str
    taken_at: datetime
    image_url: str
    detections: list[DetectionOut]
    analyzed: bool
    provider: str | None
    note: str | None


def snapshot_out(s: Snapshot) -> SnapshotOut:
    return SnapshotOut(
        id=s.id,
        camera_id=s.camera_id,
        taken_at=s.taken_at,
        image_url=s.image_url,
        analyzed=s.analyzed,
        provider=s.provider,
        note=s.note,
        detections=[
            DetectionOut(
                id=f"d{d.id}",
                type=d.equipment_type,
                confidence=d.confidence,
                moving=d.moving,
                box=BoxOut(x=d.x, y=d.y, w=d.w, h=d.h),
            )
            for d in s.detections
        ],
    )


# ---------- предупреждения ----------
AlertStatus = Literal["new", "acknowledged", "confirmed", "prescribed", "resolved", "false_positive"]


class AlertEventOut(ApiModel):
    at: datetime
    who: str
    text: str


class AlertOut(ApiModel):
    id: str
    code: str
    site_id: str
    zone_id: str
    stage_id: str | None
    camera_id: str | None
    kind: Literal["missing", "count_below", "unexpected", "idle", "camera_offline"]
    severity: Literal["high", "medium", "low"]
    status: AlertStatus
    is_open: bool
    title: str
    summary: str
    consequence: str
    advice: str
    equipment: EquipmentType | None
    expected: int | None
    observed: int | None
    prescription_no: str | None
    started_at: datetime
    updated_at: datetime
    evidence: list[str]
    evidence_snapshots: list[SnapshotOut]
    history: list[AlertEventOut]


def alert_code(a: Alert) -> str:
    return f"ОТК-{a.started_at.year % 100:02d}-{a.number:04d}"


def alert_out(a: Alert) -> AlertOut:
    return AlertOut(
        id=a.id,
        code=alert_code(a),
        site_id=a.site_id,
        zone_id=a.zone_id,
        stage_id=a.stage_id,
        camera_id=a.camera_id,
        kind=a.kind,
        severity=a.severity,
        status=a.status,
        is_open=a.status in OPEN_STATUSES,
        title=a.title,
        summary=a.summary,
        consequence=a.consequence,
        advice=a.advice,
        equipment=a.equipment_type,
        expected=a.expected,
        observed=a.observed,
        prescription_no=a.prescription_no,
        started_at=a.started_at,
        updated_at=a.updated_at,
        evidence=[s.id for s in a.evidence],
        evidence_snapshots=[snapshot_out(s) for s in a.evidence],
        history=[AlertEventOut(at=e.at, who=e.who, text=e.text) for e in a.events],
    )


class AlertActionIn(ApiModel):
    status: AlertStatus
    comment: str = Field(default="", max_length=1000)


# ---------- сверка ----------
class CheckRow(ApiModel):
    type: EquipmentType
    need: int
    have: int
    state: Literal["ok", "low", "missing"]
    why: str


class ExtraRow(ApiModel):
    type: EquipmentType
    have: int
    why: str


class EquipmentCheckOut(ApiModel):
    """Сравнение «нужно по плану / видим на камерах» для текущего этапа объекта."""

    site_id: str
    stage_id: str | None
    stage_name: str | None
    coverage: bool  # есть ли свежий кадр рабочей зоны
    checked_at: datetime | None
    rows: list[CheckRow]
    extra: list[ExtraRow]  # техника не по этапу
    arriving: dict[str, int]  # техника на въезде и складе — «подъезжает», в норму не засчитывается


class CheckRunOut(ApiModel):
    id: str
    site_id: str
    at: datetime
    trigger: str
    stage_id: str | None
    coverage: bool
    observed: dict[str, int]
    arriving: dict[str, int]
    violations: list[dict]


def check_out(c: CheckRun) -> CheckRunOut:
    return CheckRunOut(
        id=c.id,
        site_id=c.site_id,
        at=c.at,
        trigger=c.trigger,
        stage_id=c.stage_id,
        coverage=c.coverage,
        observed=c.observed,
        arriving=c.arriving,
        violations=c.violations,
    )


class CaptureOut(ApiModel):
    check: CheckRunOut
    snapshots: list[SnapshotOut]
    errors: dict[str, str]


class DeviationOut(ApiModel):
    kind: Literal["missing", "count_below", "unexpected"]
    type: EquipmentType
    need: int | None
    have: int
    title: str
    why: str


class AnalyzeOut(ApiModel):
    """Результат разбора одного снимка: техника + сверка с правилом этапа."""

    provider: str
    model: str | None
    supported: bool
    note: str | None
    elapsed_ms: int
    image_url: str | None
    detections: list[DetectionOut]
    rule_key: str
    stage_name: str
    rows: list[CheckRow]
    deviations: list[DeviationOut]


# ---------- отчёт ----------
class DayCount(ApiModel):
    date: date
    label: str
    count: int


class SiteCount(ApiModel):
    site_id: str
    name: str
    count: int
    high: int


class NamedCount(ApiModel):
    key: str
    count: int


class WeeklyReportOut(ApiModel):
    date_from: date
    date_to: date
    total: int
    open: int
    resolved: int
    false_positive: int
    by_day: list[DayCount]
    by_site: list[SiteCount]
    by_kind: list[NamedCount]
    by_equipment: list[NamedCount]
