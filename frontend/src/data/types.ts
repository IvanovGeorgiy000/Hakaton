/**
 * Типы данных интерфейса. Совпадают с JSON, который отдаёт бэкенд (backend/app/schemas.py).
 */

export type EquipmentType =
  | 'excavator'     // экскаватор
  | 'dump_truck'    // самосвал
  | 'roller'        // каток
  | 'manipulator'   // кран-манипулятор
  | 'mixer'         // автобетоносмеситель
  | 'bulldozer'     // бульдозер
  | 'truck'         // грузовик
  | 'crane'         // автокран

export interface EquipmentInfo {
  type: EquipmentType
  name: string           // «Экскаватор»
  namePlural: string     // «экскаваторы»
  genitivePlural: string // «экскаваторов»
  color: string          // цвет рамки на снимке
}

export type RoleId = 'foreman' | 'manager' | 'inspector' | 'admin'

export interface Role {
  id: RoleId
  title: string
  subtitle: string
  description: string
}

export interface User {
  id: string
  login: string
  name: string
  role: RoleId
  phone: string
  siteIds: string[]
  isActive: boolean
}

export type SiteStatus = 'ok' | 'warning' | 'critical'

/** Вид объекта: у дороги и у дома разные этапы и техника — подсказка сервису, который определяет этап по кадрам */
export type SiteKind = 'residential' | 'public' | 'road' | 'industrial' | 'other'

export interface Site {
  id: string
  name: string
  address: string
  contractor: string
  foreman: string
  kind: SiteKind
  currentStageId: string | null
  /** По всему плану объекта: сколько должно быть сделано по графику и сколько по факту, %. null — плана нет */
  planProgress: number | null
  factProgress: number | null
}

export type ZoneKind = 'work' | 'gate' | 'storage'

export interface Zone {
  id: string
  siteId: string
  name: string
  kind: ZoneKind
}

/** Камера — всегда видеопоток RTSP. Видео отдаёт шлюз по WebRTC: {meta.video.webrtcUrl}/{streamPath}/whep */
export interface Camera {
  id: string
  siteId: string
  zoneId: string
  name: string
  /** Включена и на связи */
  online: boolean
  enabled: boolean
  status: 'online' | 'offline' | 'unknown'
  sourceType: 'rtsp'
  /** Адрес видеопотока без логина и пароля */
  address: string | null
  hasCredentials: boolean
  /** Смотрит на демо-ролик шлюза */
  demo: boolean
  streamPath: string
  lastError: string | null
  lastSnapshotAt: string | null
  scene: 'pit' | 'foundation' | 'road' | 'entrance' | 'yard'
}

/** Что видит анализ на камере прямо сейчас (кадр из видео разбирается каждые 2 секунды) */
export interface LiveCamera {
  cameraId: string
  online: boolean
  error: string | null
  receivedAt: string | null
  analyzedAt: string | null
  analyzed: boolean | null
  note: string | null
  detections: Detection[]
  counts: Partial<Record<EquipmentType, number>>
}

export interface Stage {
  id: string
  siteId: string
  parentId: string | null
  level: 1 | 2
  name: string
  start: string
  end: string
  status: 'done' | 'in_progress' | 'planned'
  ruleKey: string | null
  /** Сколько должно быть сделано к сегодняшнему дню по графику, % */
  planProgress: number
  /** Сколько сделано по факту, % (у этапа с работами считается по работам) */
  factProgress: number
  factUpdatedAt: string | null
}

/** risk — чем грозит нехватка; сервер всегда отдаёт строку (пустую, если не задано) */
export interface RuleRequirement { type: EquipmentType; min: number; why: string; risk: string }
export interface RuleForbidden { type: EquipmentType; why: string; risk: string }

/** Правило методики: «этап работ → необходимая техника» */
export interface Rule {
  key: string
  stageName: string
  description: string
  required: RuleRequirement[]
  allowed: EquipmentType[]
  unexpected: RuleForbidden[]
  /** Сколько проверок подряд подтверждают отклонение */
  confirmAfterSnapshots: number
}

export interface Detection {
  id: string
  type: EquipmentType
  confidence: number
  /** Рамка в процентах от кадра 16:9 */
  box: { x: number; y: number; w: number; h: number }
  moving?: boolean | null
}

export interface Snapshot {
  id: string
  cameraId: string
  takenAt: string
  imageUrl: string
  detections: Detection[]
  /** false — кадр получен, но разобрать его не удалось */
  analyzed: boolean
  provider: string | null
  note: string | null
}

export type AlertKind = 'missing' | 'count_below' | 'unexpected' | 'idle' | 'camera_offline'
export type Severity = 'high' | 'medium' | 'low'
export type AlertStatus = 'new' | 'acknowledged' | 'confirmed' | 'prescribed' | 'resolved' | 'false_positive'

export interface AlertEvent { at: string; who: string; text: string }

export interface Alert {
  id: string
  code: string
  siteId: string
  zoneId: string
  stageId: string | null
  cameraId: string | null
  kind: AlertKind
  severity: Severity
  status: AlertStatus
  isOpen: boolean
  title: string
  summary: string
  consequence: string
  advice: string
  equipment: EquipmentType | null
  expected: number | null
  observed: number | null
  prescriptionNo: string | null
  /** Срок устранения по предписанию, «2026-09-30» */
  prescriptionDue: string | null
  startedAt: string
  updatedAt: string
  evidence: string[]
  evidenceSnapshots: Snapshot[]
  history: AlertEvent[]
}

// ---------- ответы отдельных методов ----------
export interface CheckRow { type: EquipmentType; need: number; have: number; state: 'ok' | 'low' | 'missing'; why: string }
export interface ExtraRow { type: EquipmentType; have: number; why: string }

export interface EquipmentCheckResult {
  siteId: string
  stageId: string | null
  stageName: string | null
  coverage: boolean
  checkedAt: string | null
  rows: CheckRow[]
  extra: ExtraRow[]
  arriving: Partial<Record<EquipmentType, number>>
}

export interface Deviation { kind: 'missing' | 'count_below' | 'unexpected'; type: EquipmentType; need: number | null; have: number; title: string; why: string }

export interface AnalyzeResult {
  provider: string
  model: string | null
  supported: boolean
  note: string | null
  elapsedMs: number
  imageUrl: string | null
  detections: Detection[]
  ruleKey: string
  stageName: string
  rows: CheckRow[]
  deviations: Deviation[]
}

export interface Sample { id: string; label: string; imageUrl: string }

export interface Connection {
  protocol: 'rtsp'
  host: string
  port: number | null
  path: string
  username: string | null
  password: string | null
}

/** previewPath — временный поток в шлюзе: форма показывает по нему видео камеры до сохранения */
export interface ProbeResult { ok: boolean; code: string; message: string; elapsedMs: number; previewPath: string | null }

export interface CameraPatch { name?: string; enabled?: boolean; zoneId?: string; connection?: Connection }

export interface NewCamera {
  siteId: string
  name: string
  zoneId: string | null
  newZoneName: string | null
  newZoneKind: ZoneKind
  connection: Connection
  allowOffline: boolean
}

/** Демо-ролик шлюза как обычный RTSP-адрес — для быстрой настройки в форме камеры */
export interface DemoFeed { clip: string; title: string; host: string; port: number; path: string }

export interface Meta {
  version: string
  demoMode: boolean
  analysisProvider: string
  timezone: string
  /** Время сервера в ISO — по нему видно, не разошлись ли часы устройства и сервера */
  serverTime: string
  database: 'sqlite' | 'postgresql'
  authMode: 'local' | 'keycloak'
  keycloak: { url: string; realm: string; clientId: string } | null
  video: { enabled: boolean; webrtcUrl: string; frameIntervalS: number; checkIntervalS: number }
  /** Рамки в реальном времени (WebSocket /api/tracks): модель на сервере разбирает видео или их шлёт внешний сервис разметки */
  tracker: {
    enabled: boolean
    connected: boolean
    videoDelayMs: number
    /** Когда пришло последнее сообщение с рамками */
    lastMessageAt: string | null
  }
  demoFeeds: DemoFeed[]
}

// ---------- администрирование ----------
export interface SiteInput {
  name: string
  address: string
  contractor: string
  kind?: SiteKind
  /** id прораба; null — снять прораба с объекта; поля нет — прораба не менять */
  foremanId?: string | null
}

export interface ZoneInput { name: string; kind: ZoneKind }

export interface StageInput { name: string; level: 1 | 2; parentId: string | null; start: string; end: string; ruleKey: string | null; factProgress?: number | null }

export interface UserInput { login: string; name: string; role: RoleId; phone: string; siteIds: string[]; password: string }

export interface UserPatch { name?: string; role?: RoleId; phone?: string; siteIds?: string[]; isActive?: boolean }

/** Запись журнала действий: кто, когда, что сделал */
export interface AuditEvent {
  id: number
  at: string
  actorLogin: string
  actorName: string
  actorRole: RoleId | ''
  action: string
  entityType: string
  entityId: string | null
  entityName: string
  summary: string
  details: Record<string, unknown>
  ip: string
}

export interface WeeklyReport {
  dateFrom: string
  dateTo: string
  total: number
  open: number
  resolved: number
  falsePositive: number
  byDay: { date: string; label: string; count: number }[]
  bySite: { siteId: string; name: string; count: number; high: number }[]
  byKind: { key: AlertKind; count: number }[]
  byEquipment: { key: EquipmentType; count: number }[]
}
