import type { AlertKind, AlertStatus, Severity, SiteKind } from '@/data'

export const SEVERITY: Record<Severity, { label: string; tone: 'danger' | 'warn' | 'info'; bar: string }> = {
  high: { label: 'Срочно', tone: 'danger', bar: 'bg-danger' },
  medium: { label: 'Важно', tone: 'warn', bar: 'bg-warn' },
  low: { label: 'На заметку', tone: 'info', bar: 'bg-info' },
}

export const KIND: Record<AlertKind, string> = {
  missing: 'Нет нужной техники',
  count_below: 'Техники меньше нормы',
  unexpected: 'Техника не по этапу',
  idle: 'Простой техники',
  camera_offline: 'Камера не работает',
}

export const STATUS: Record<AlertStatus, { label: string; tone: 'danger' | 'warn' | 'info' | 'ok' | 'neutral' }> = {
  new: { label: 'Новое', tone: 'danger' },
  acknowledged: { label: 'В работе', tone: 'warn' },
  confirmed: { label: 'Подтверждено', tone: 'warn' },
  prescribed: { label: 'Предписание', tone: 'info' },
  resolved: { label: 'Устранено', tone: 'ok' },
  false_positive: { label: 'Ошибка системы', tone: 'neutral' },
}

export const STAGE_STATUS = {
  done: { label: 'Завершён', tone: 'ok' as const },
  in_progress: { label: 'Идёт сейчас', tone: 'info' as const },
  planned: { label: 'Впереди', tone: 'neutral' as const },
}

/** Виды объектов — для формы объекта и подписи на его странице */
export const SITE_KIND: Record<SiteKind, string> = {
  residential: 'Жилой дом',
  public: 'Социальный объект (школа, детский сад, больница)',
  road: 'Дорога',
  industrial: 'Промышленный объект',
  other: 'Другое',
}
