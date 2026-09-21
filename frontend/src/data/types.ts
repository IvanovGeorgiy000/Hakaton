/**
 * Модель данных прототипа (мок).
 * Соответствует разделу 5 ТЗ: техника, этапы работ, отклонения и нарушения.
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
  name: string          // «Экскаватор»
  namePlural: string    // «экскаваторы»
  genitivePlural: string // «экскаваторов» (для фраз «нет экскаваторов»)
  color: string         // цвет рамки на снимке
}

export type RoleId = 'foreman' | 'manager' | 'inspector' | 'admin'

export interface Role {
  id: RoleId
  title: string
  subtitle: string
  description: string
  /** Прораб видит только свой объект */
  siteId?: string
}

export type SiteStatus = 'ok' | 'warning' | 'critical'

export interface Zone {
  id: string
  siteId: string
  name: string
}

export interface Camera {
  id: string
  siteId: string
  zoneId: string
  name: string
  online: boolean
  lastSnapshotAt: string
  /** Тип сцены для отрисовки мок-кадра */
  scene: 'pit' | 'foundation' | 'road' | 'entrance' | 'yard'
}

export interface Site {
  id: string
  name: string
  address: string
  contractor: string
  foreman: string
  /** Ключ текущего этапа (уровень 2) */
  currentStageId: string
  planProgress: number  // % по плану на сегодня
  factProgress: number  // % фактически
}

export interface Stage {
  id: string
  siteId: string
  parentId?: string      // для уровня 2
  level: 1 | 2
  name: string
  start: string          // ISO date
  end: string
  status: 'done' | 'in_progress' | 'planned'
  /** Ключ методики (правило) — только для уровня 2 */
  ruleKey?: RuleKey
}

export type RuleKey =
  | 'site_prep'
  | 'excavation'
  | 'soil_removal'
  | 'backfill'
  | 'foundation_concrete'
  | 'frame_assembly'
  | 'road_base'
  | 'asphalt'
  | 'landscaping'

export interface RuleRequirement {
  type: EquipmentType
  min: number
  why: string
}

export interface RuleForbidden {
  type: EquipmentType
  why: string
}

/** Правило методики: «этап работ → необходимая техника» */
export interface Rule {
  key: RuleKey
  stageName: string
  description: string
  required: RuleRequirement[]
  allowed: EquipmentType[]
  unexpected: RuleForbidden[]
  /** Сколько снимков подряд без нужной техники считаем отклонением */
  confirmAfterSnapshots: number
}

export interface Detection {
  id: string
  type: EquipmentType
  confidence: number      // 0..1
  /** Рамка в процентах от кадра */
  box: { x: number; y: number; w: number; h: number }
  moving?: boolean
}

export interface Snapshot {
  id: string
  cameraId: string
  takenAt: string
  detections: Detection[]
  /** Настоящий кадр с камеры (например, /snapshots/c1-1230.jpg). Если не задан — рисуется схема. */
  imageUrl?: string
}

export type AlertKind =
  | 'missing'       // нет нужной техники
  | 'count_below'   // техники меньше, чем нужно
  | 'unexpected'    // техника не по этапу
  | 'idle'          // техника простаивает
  | 'camera_offline'

export type Severity = 'high' | 'medium' | 'low'

export type AlertStatus =
  | 'new'            // новое
  | 'acknowledged'   // принято в работу (прораб ответил)
  | 'confirmed'      // проблема подтверждена
  | 'prescribed'     // выдано предписание (инспектор)
  | 'resolved'       // устранено
  | 'false_positive' // ошибка распознавания

export interface AlertEvent {
  at: string
  who: string
  text: string
}

export interface Alert {
  id: string
  siteId: string
  zoneId: string
  stageId: string
  kind: AlertKind
  severity: Severity
  status: AlertStatus
  title: string          // короткая фраза простым языком
  summary: string        // что произошло
  consequence: string    // чем грозит
  advice: string         // что делать
  equipment?: EquipmentType
  expected?: number
  observed?: number
  startedAt: string
  evidence: string[]     // id снимков
  history: AlertEvent[]
}

export interface User {
  id: string
  name: string
  role: RoleId
  phone: string
  siteIds: string[]
}
