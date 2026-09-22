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
}

export type SiteStatus = 'ok' | 'warning' | 'critical'

export interface Site {
  id: string
  name: string
  address: string
  contractor: string
  foreman: string
  currentStageId: string | null
  planProgress: number
  factProgress: number
}

export type ZoneKind = 'work' | 'gate' | 'storage'

export interface Zone {
  id: string
  siteId: string
  name: string
  kind: ZoneKind
}

export interface Camera {
  id: string
  siteId: string
  zoneId: string
  name: string
  /** Включена и на связи */
  online: boolean
  enabled: boolean
  status: 'online' | 'offline' | 'unknown'
  sourceType: 'mock' | 'http' | 'rtsp'
  /** Адрес без логина и пароля; у демонстрационных камер — null */
  address: string | null
  hasCredentials: boolean
  lastError: string | null
  lastSnapshotAt: string | null
  scene: 'pit' | 'foundation' | 'road' | 'entrance' | 'yard'
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
}

export interface RuleRequirement { type: EquipmentType; min: number; why: string; risk?: string }
export interface RuleForbidden { type: EquipmentType; why: string; risk?: string }

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

export interface CaptureResult {
  check: { id: string; at: string; violations: { kind: AlertKind; equipment: EquipmentType | null }[] }
  snapshots: Snapshot[]
  errors: Record<string, string>
}

export interface Connection {
  protocol: 'http' | 'https' | 'rtsp'
  host: string
  port: number | null
  path: string
  username: string | null
  password: string | null
}

export interface ProbeResult { ok: boolean; code: string; message: string; elapsedMs: number; preview: string | null }

export interface NewCamera {
  siteId: string
  name: string
  zoneId: string | null
  newZoneName: string | null
  newZoneKind: ZoneKind
  connection: Connection
  allowOffline: boolean
}

export interface DemoCamera { title: string; host: string; port: number; path: string }

export interface Meta {
  version: string
  demoMode: boolean
  analysisProvider: string
  captureIntervalS: number
  timezone: string
  demoCameras: DemoCamera[]
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
