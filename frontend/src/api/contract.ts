/**
 * Сверка типов фронтенда со схемой API бэкенда — на этапе сборки (tsc), без запуска.
 *
 * openapi.d.ts генерируется из схемы сервера: `npm run gen:api` (нужен uv и бэкенд рядом). Типы в data/types.ts
 * написаны вручную — они уже и точнее (например, вид сцены камеры — список, а не любая строка). Здесь проверяем,
 * что поля совпадают по составу, а их типы на фронте не шире, чем отдаёт сервер. Поменяли схему на бэкенде
 * и перегенерировали openapi.d.ts — tsc покажет, какой тип фронтенда отстал и чем именно.
 */
import type {
  Alert, AlertEvent, AnalyzeResult, AuditEvent, Camera, CheckRow, Detection, Deviation, EquipmentCheckResult, ExtraRow,
  LiveCamera, Meta, ProbeResult, Rule, Site, Snapshot, Stage, User, WeeklyReport, Zone,
} from '@/data'
import type { components } from './openapi'

type S = components['schemas']

/** true — совпадают; иначе — объект с подсказкой, чего не хватает и что лишнее (tsc выведет его в ошибке) */
type Same<Front, Back> =
  [Exclude<keyof Front, keyof Back>, Exclude<keyof Back, keyof Front>] extends [never, never]
    ? Front extends Back ? true : { типы_полей_шире_чем_на_сервере: { [K in keyof Front]: Front[K] extends Back[K & keyof Back] ? never : K }[keyof Front] }
    : { лишние_поля_на_фронте: Exclude<keyof Front, keyof Back>; нет_на_фронте: Exclude<keyof Back, keyof Front> }

type Check<T extends true> = T

export type Contract = [
  Check<Same<Alert, S['AlertOut']>>,
  Check<Same<AlertEvent, S['AlertEventOut']>>,
  Check<Same<Camera, S['CameraOut']>>,
  Check<Same<LiveCamera, S['LiveCameraOut']>>,
  Check<Same<Site, S['SiteOut']>>,
  Check<Same<Zone, S['ZoneOut']>>,
  Check<Same<Stage, S['StageOut']>>,
  Check<Same<Rule, S['RuleOut']>>,
  Check<Same<Snapshot, S['SnapshotOut']>>,
  Check<Same<Detection, S['DetectionOut']>>,
  Check<Same<User, S['UserOut']>>,
  Check<Same<Meta, S['MetaOut']>>,
  Check<Same<WeeklyReport, S['WeeklyReportOut']>>,
  Check<Same<EquipmentCheckResult, S['EquipmentCheckOut']>>,
  Check<Same<CheckRow, S['CheckRow']>>,
  Check<Same<ExtraRow, S['ExtraRow']>>,
  Check<Same<AnalyzeResult, S['AnalyzeOut']>>,
  Check<Same<Deviation, S['DeviationOut']>>,
  Check<Same<ProbeResult, S['ProbeOut']>>,
  Check<Same<AuditEvent, S['AuditOut']>>,
]
