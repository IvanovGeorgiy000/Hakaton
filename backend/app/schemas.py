"""Схемы API. JSON — в camelCase и совпадает с типами фронтенда (frontend/src/data/types.ts)."""

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.config import get_settings
from app.equipment import EQUIPMENT_TYPES
from app.models import OPEN_STATUSES, Alert, Camera, CheckRun, Rule, Site, Snapshot, Stage, User, Zone
from app.services.camera_client import CameraAddress

EquipmentType = Literal["excavator", "dump_truck", "roller", "manipulator", "mixer", "bulldozer", "truck", "crane"]
RoleId = Literal["foreman", "manager", "inspector", "admin"]
assert set(EquipmentType.__args__) == set(EQUIPMENT_TYPES)
_TZ = ZoneInfo(get_settings().timezone)


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
    is_active: bool = True


class TokenOut(ApiModel):
    token: str
    user: UserOut


def user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id, login=u.login, name=u.name, role=u.role, phone=u.phone, site_ids=[s.id for s in u.sites], is_active=u.is_active
    )


class UserIn(ApiModel):
    login: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=2, max_length=120)
    role: RoleId
    phone: str = Field(default="", max_length=32)
    site_ids: list[str] = []
    password: str = Field(min_length=6, max_length=200)


class UserPatch(ApiModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    role: RoleId | None = None
    phone: str | None = Field(default=None, max_length=32)
    site_ids: list[str] | None = None
    is_active: bool | None = None


class PasswordIn(ApiModel):
    password: str = Field(min_length=6, max_length=200)


# ---------- объекты ----------
# вид объекта — как models.SITE_KINDS: виды «Справочника видов работ» (жильё, школа, детский сад…, дороги) и ещё
# соцобъект без уточнения, промышленный, другое
SiteKind = Literal[
    "housing",
    "education",
    "preschool",
    "healthcare",
    "sports",
    "culture",
    "administrative",
    "office",
    "roads",
    "public",
    "industrial",
    "other",
]


class SiteOut(ApiModel):
    id: str
    name: str
    address: str
    contractor: str
    foreman: str
    kind: SiteKind
    current_stage_id: str | None
    plan_progress: int | None  # сколько должно быть сделано по графику, % — по всему плану; None — плана нет
    fact_progress: int | None  # сколько сделано по факту, %


def site_out(s: Site, current_stage_id: str | None, progress: tuple[int, int] | None) -> SiteOut:
    return SiteOut(
        id=s.id,
        name=s.name,
        address=s.address,
        contractor=s.contractor,
        foreman=s.foreman_name,
        kind=s.kind,
        current_stage_id=current_stage_id,
        plan_progress=progress[0] if progress else None,
        fact_progress=progress[1] if progress else None,
    )


class SiteIn(ApiModel):
    name: str = Field(min_length=2, max_length=200)
    address: str = Field(default="", max_length=200)
    contractor: str = Field(default="", max_length=200)
    kind: SiteKind = "other"
    foreman_id: str | None = None  # прораб объекта: получит к нему доступ; явный null — снять прораба, поля нет — не трогать


class ZoneIn(ApiModel):
    name: str = Field(min_length=2, max_length=200)
    kind: Literal["work", "gate", "storage"] = "work"


class StageIn(ApiModel):
    name: str = Field(min_length=2, max_length=200)
    level: Literal[1, 2] = 2  # 1 — укрупнённый этап, 2 — работы с правилом «этап → техника»
    parent_id: str | None = None
    start: date
    end: date
    rule_key: str | None = None
    fact_progress: int | None = Field(default=None, ge=0, le=100)  # None — не менять
    # вид работ по справочнику сервисов аналитики (только у работ); явный null — снять, поля нет — не трогать
    catalog_stage_id: int | None = Field(default=None, ge=0)


class StageProgressIn(ApiModel):
    fact_progress: int = Field(ge=0, le=100)


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
    plan_progress: int  # сколько должно быть сделано к сегодняшнему дню по графику, %
    fact_progress: int  # сколько сделано по факту, %
    fact_updated_at: datetime | None
    catalog_stage_id: int | None  # вид работ по справочнику сервисов аналитики
    catalog_version: str | None  # по какой версии справочника он выбран


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
        plan_progress=s.plan_progress_on(today),
        fact_progress=s.fact_progress,
        fact_updated_at=s.fact_updated_at,
        catalog_stage_id=s.catalog_stage_id,
        catalog_version=s.catalog_version,
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
    source_type: Literal["rtsp"]
    address: str | None  # без логина и пароля
    has_credentials: bool
    demo: bool  # смотрит на демо-ролик шлюза
    stream_path: str  # поток в шлюзе видео: WebRTC по адресу {videoUrl}/{streamPath}/whep
    last_error: str | None
    last_snapshot_at: datetime | None
    scene: str


def camera_out(c: Camera) -> CameraOut:
    from app.services.video import camera_path, demo_clip_of

    address = CameraAddress(c.scheme or "rtsp", c.host, c.port or 554, c.path or "/").display if c.host else None
    return CameraOut(
        id=c.id,
        site_id=c.site_id,
        zone_id=c.zone_id,
        name=c.name,
        enabled=c.enabled,
        status=c.status,
        online=c.enabled and c.status != "offline",
        source_type="rtsp",
        address=address,
        has_credentials=bool(c.username),
        demo=demo_clip_of(c.path) is not None,
        stream_path=camera_path(c.id),
        last_error=c.last_error,
        last_snapshot_at=c.last_snapshot_at,
        scene=c.scene,
    )


class ConnectionIn(ApiModel):
    protocol: Literal["rtsp"] = "rtsp"
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
    connection: ConnectionIn | None = None  # новый адрес; пароль пустой — оставить прежний


class ProbeOut(ApiModel):
    ok: bool
    code: str
    message: str
    elapsed_ms: int
    preview_path: str | None = None  # временный поток в шлюзе: видео для предпросмотра в форме (живёт 10 минут)


class LiveCameraOut(ApiModel):
    """Что видит анализ на камере прямо сейчас (обновляется каждые 2 секунды)."""

    camera_id: str
    online: bool
    error: str | None
    received_at: datetime | None  # последний кадр из видео
    analyzed_at: datetime | None  # последний разобранный кадр
    analyzed: bool | None  # False — сервис анализа не смог разобрать кадр
    note: str | None
    detections: list["DetectionOut"]
    counts: dict[str, int]


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
    prescription_due: date | None
    started_at: datetime
    updated_at: datetime
    evidence: list[str]
    evidence_snapshots: list[SnapshotOut]
    history: list[AlertEventOut]


def alert_code(a: Alert) -> str:
    # год по местному времени: отклонение в 01:00 1 января иначе получало номер прошлого года
    return f"ОТК-{a.started_at.astimezone(_TZ).year % 100:02d}-{a.number:04d}"


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
        prescription_due=a.prescription_due,
        started_at=a.started_at,
        updated_at=a.updated_at,
        evidence=[s.id for s in a.evidence],
        evidence_snapshots=[snapshot_out(s) for s in a.evidence],
        history=[AlertEventOut(at=e.at, who=e.who, text=e.text) for e in a.events],
    )


class AlertActionIn(ApiModel):
    status: AlertStatus
    comment: str = Field(default="", max_length=1000)
    due_date: date | None = None  # срок устранения — только для предписания


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


class AuditOut(ApiModel):
    id: int
    at: datetime
    actor_login: str
    actor_name: str
    actor_role: str
    action: str
    entity_type: str
    entity_id: str | None
    entity_name: str
    summary: str
    details: dict
    ip: str


def audit_out(e) -> AuditOut:  # noqa: ANN001
    return AuditOut(
        id=e.id, at=e.at, actor_login=e.actor_login, actor_name=e.actor_name, actor_role=e.actor_role, action=e.action,
        entity_type=e.entity_type, entity_id=e.entity_id, entity_name=e.entity_name, summary=e.summary,
        details=e.details or {}, ip=e.ip,
    )  # fmt: skip


class IngestOut(ApiModel):
    accepted: bool  # False — кадр старее уже полученного с этой камеры: картину он не меняет
    detections: int
    note: str


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


# ---------- рамки в реальном времени ----------
class TrackerCameraOut(ApiModel):
    """Камера для сервиса разметки: какой поток читать из шлюза."""

    id: str
    name: str
    site_id: str
    zone_kind: str  # work — рабочая зона, gate — въезд, storage — склад
    rtsp_url: str  # логин шлюза sk-tracker, пароль — ключ сервиса
    demo_clip: str | None  # камера смотрит демо-ролик (для имитации сервиса)


class EquipmentUsageOut(ApiModel):
    """Сколько работала техника за час на одной камере (по рамкам сервиса разметки)."""

    hour: datetime  # начало часа
    camera_id: str
    zone_kind: str  # work | gate | storage
    type: EquipmentType
    max_count: int  # сколько машин этого типа было в кадре одновременно
    present_min: float  # сколько минут тип был в кадре
    moving_min: float  # из них двигался


# ---------- работы по камерам: ответы сервисов аналитики ----------
AnalyticsService = Literal["deterministic", "vlm_llm"]


class WorkRefOut(ApiModel):
    """Пункт плана в ответе сервиса: наша работа (step_key) и вид работ по справочнику (stage_id)."""

    step_key: str
    stage_id: int | None
    name: str  # название работы в нашем плане; удалена — название вида работ из справочника
    in_plan: bool  # работа всё ещё есть в плане


class WorkEvidenceOut(ApiModel):
    source: str  # cv_detection | visual_observation | visual_relation | progress_event
    role: str  # supports | contradicts
    explanation: str


class WorkGroupOut(ApiModel):
    """Одна операция на кадре: specific — один кандидат, ambiguous — альтернативы (одна из них)."""

    match: str
    works: list[WorkRefOut]
    visual_state: str  # operation_indicated | presence_or_result_only | not_evaluated
    explanation: str
    evidence: list[WorkEvidenceOut]
    area: list[float] | None  # [x_min, y_min, x_max, y_max] в долях кадра


class TransitionOut(ApiModel):
    """Следующая работа по технике (сервис «по технике»): possible_start — похоже, она началась."""

    status: str
    current: WorkRefOut | None
    next: WorkRefOut | None
    first_at: datetime | None
    last_at: datetime | None
    points: int  # сколько разных моментов (через 15+ минут) видна техника следующей работы


class ScheduleItemOut(ApiModel):
    work: WorkRefOut
    status: str  # possible_delay | no_delay_indicated | insufficient_evidence
    reason: str  # reason_code: open_state_after_deadline, deadline_not_reached…
    overdue_s: int | None
    evidence_at: datetime | None


class ScheduleOut(ApiModel):
    status: str  # possible_delay | no_delay_indicated | insufficient_evidence | not_evaluated
    items: list[ScheduleItemOut]


class ServiceAnswerOut(ApiModel):
    """Последний ответ одного сервиса по кадру камеры (или почему его нет)."""

    service: AnalyticsService
    state: Literal["pending", "done", "error", "unknown"]
    at: datetime | None  # когда пришёл ответ (или отказ)
    observed_at: datetime | None  # когда снят кадр, о котором ответ
    outcome: str | None  # assessed | insufficient_evidence | outside_plan | no_plan | scope_unknown
    groups: list[WorkGroupOut]
    transition: TransitionOut | None
    schedule: ScheduleOut | None
    limitations: list[str]
    model: str | None  # версия сервиса и моделей — мелким шрифтом
    error_code: str | None
    error: str | None  # почему нет ответа — руководителю и администратору
    newer_pending: bool  # по более свежему кадру уже спросили, ждём ответ


class CameraWorkOut(ApiModel):
    camera_id: str
    camera_name: str
    zone_name: str
    sent_at: datetime | None  # когда последний раз отправляли кадр
    image_url: str | None  # этот кадр, если он ещё хранится
    answers: list[ServiceAnswerOut]
    matches_plan: bool | None  # хоть один кандидат — работа, которая сегодня идёт по графику; None — не с чем сравнить


class SiteWorkOut(ApiModel):
    """Какая работа идёт на кадрах камер — по ответам двух сервисов аналитики, рядом с графиком."""

    enabled: bool  # подключён хоть один сервис
    services: list[AnalyticsService]
    can_run: bool  # может ли пользователь отправить кадры сейчас (руководитель, администратор)
    running: bool  # сейчас идёт отправка по этому объекту
    planned: list[str]  # работы, которые сегодня идут по графику
    plan_issue: str | None  # почему план не уходит сервисам (не у всех работ выбран вид по справочнику…)
    problem: str | None  # почему последний кадр не ушёл (справочник недоступен, кадр повреждён…)
    cameras: list[CameraWorkOut]
    catalog_version: str | None
    next_at: datetime | None  # следующая плановая отправка


class CatalogWorkOut(ApiModel):
    stage_id: int
    name: str
    path: list[str]  # разделы справочника над работой


class AnalyticsCatalogOut(ApiModel):
    """Виды работ справочника сервисов аналитики — для поля «Вид работ по справочнику» в плане."""

    enabled: bool  # подключены ли сервисы
    version: str | None
    object_type: str | None  # вид объекта по справочнику; None — неизвестен, показаны все работы
    works: list[CatalogWorkOut]
    error: str | None  # справочник не получен (или показан сохранённый: сервисы не ответили)


class TrackerStatusOut(ApiModel):
    """Откуда рамки в реальном времени и что с ними — для отладки (только администратору и руководителю)."""

    enabled: bool
    source: str | None  # model — своя модель по видео камер; service — внешний сервис разметки; None — рамок нет
    connected: bool
    messages: int  # сколько сообщений с рамками было с запуска сервера
    last_message_at: datetime | None
    problem: str | None  # внешний сервис: последняя ошибка формата (рамка в долях 0–1, нет track_id…)
    problem_at: datetime | None
    viewers: int  # сколько браузеров сейчас смотрят рамки
    live_cameras: list[str]  # своя модель: камеры, чьё видео она сейчас разбирает (их кто-то смотрит)
    model: str | None  # своя модель: название
    model_device: str | None  # на чём считает: CPU, CoreML, CUDA
    model_ms: float | None  # сколько в среднем занимает один кадр
