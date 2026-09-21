import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Все даты показываем по Москве независимо от настроек устройства */
const TZ = 'Europe/Moscow'

/** Форматирует время «ЧЧ:ММ» из ISO-строки */
export function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

/** Форматирует дату «15 сентября» */
export function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ })
}

/** «15.09.2026» */
export function fmtDateShort(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ })
}

/** Человекочитаемая давность: «2 ч назад», «15 мин назад» */
export function ago(iso: string, now = NOW) {
  const diff = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'только что'
  if (diff < 60) return `${Math.round(diff)} мин назад`
  const h = Math.floor(diff / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  return d === 1 ? 'вчера' : `${d} дн. назад`
}

/** Фиксированное «сейчас» для демонстрации, чтобы мок-данные выглядели актуальными */
export const NOW = new Date('2026-09-15T12:40:00+03:00')

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`
  return `${n} ${many}`
}

/** Только слово в нужной форме: pluralWord(2, 'объект', 'объекта', 'объектов') → «объекта» */
export function pluralWord(n: number, one: string, few: string, many: string) {
  return plural(n, one, few, many).replace(/^\d+\s/, '')
}

/** «Кузнецов Андрей» → «Кузнецов А.» */
export function shortName(full: string) {
  const [last, first] = full.split(' ')
  return first ? `${last} ${first[0]}.` : last
}
