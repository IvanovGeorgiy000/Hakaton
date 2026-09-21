import { ROLES, SITES, STAGES, ZONES, type Alert, type AlertStatus, type RoleId } from '@/data'

/** Открытые (нерешённые) статусы */
export function isOpen(status: AlertStatus) {
  return status === 'new' || status === 'acknowledged' || status === 'confirmed' || status === 'prescribed'
}

export function roleTitle(id: RoleId) {
  return ROLES.find((r) => r.id === id)?.title ?? id
}

// ---- Удобные селекторы по статичным справочникам ----
export const bySite = (siteId: string) => SITES.find((s) => s.id === siteId)!
export const byZone = (zoneId: string) => ZONES.find((z) => z.id === zoneId)!
export const byStage = (stageId: string) => STAGES.find((s) => s.id === stageId)!
export const stagesOf = (siteId: string) => STAGES.filter((s) => s.siteId === siteId)

const order = { high: 0, medium: 1, low: 2 }
/** Сортировка: сначала срочные, внутри — свежие */
export function bySeverity(a: Alert, b: Alert) {
  return order[a.severity] - order[b.severity] || b.startedAt.localeCompare(a.startedAt)
}

/** Номер отклонения для журнала, например «ОТК-26-0142» */
export function alertCode(a: Alert) {
  return `ОТК-26-${String(134 + Number(a.id.replace(/\D/g, '')) * 3).padStart(4, '0')}`
}

/** Инициалы для аватара */
export function initials(name: string) {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}
