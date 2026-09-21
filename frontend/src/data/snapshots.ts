import type { Detection, Snapshot } from './types'

/**
 * Снимки с камер и распознанная на них техника.
 * Кадры — настоящие фото стройплощадок (см. public/snapshots/CREDITS.md),
 * рамки размечены вручную по фото; координаты — в процентах от кадра 16:9.
 * Сегодня в демо — 15.09.2026.
 */
const img = (name: string) => `/snapshots/${name}.jpg`
const at = (date: string, time: string) => `2026-09-${date}T${time}:00+03:00`
let n = 0
const det = (type: Detection['type'], confidence: number, x: number, y: number, w: number, h: number, moving = false): Detection =>
  ({ id: `d${++n}`, type, confidence, box: { x, y, w, h }, moving })

// Один и тот же ракурс камеры — один кадр; меняется только время съёмки
const pitExcavator = () => [det('excavator', 0.94, 24.5, 41.5, 46.5, 57)]
const gateCrane = () => [det('crane', 0.91, 0.5, 19, 95.5, 79)]
const foundationOneMixer = () => [det('mixer', 0.92, 64.5, 54, 28, 20)]
const roadDumpTruck = () => [det('dump_truck', 0.9, 26, 27.5, 20, 31)]
const earthworks = () => [det('excavator', 0.93, 32, 19.5, 33, 38.5, true), det('dump_truck', 0.89, 24.5, 49, 20, 22.5)]

export const SNAPSHOTS: Snapshot[] = [
  // ----- Камера 1, котлован (объект 1): с начала смены только экскаватор, самосвалов нет -----
  ...['08:00', '09:30', '10:30', '11:30', '12:30'].map((t) => (
    { id: `sn-c1-${t.replace(':', '')}`, cameraId: 'c1', takenAt: at('15', t), imageUrl: img('pit-excavator'), detections: pitExcavator() }
  )),
  // 12 сентября: на вывозе грунта работал один самосвал вместо двух (нарушение с предписанием)
  ...['09:30', '10:30', '11:30'].map((t) => (
    { id: `sn-c1-0912-${t.replace(':', '')}`, cameraId: 'c1', takenAt: at('12', t), imageUrl: img('earthworks-loading'), detections: earthworks() }
  )),

  // ----- Камера 2, въезд (объект 1): автокран, не предусмотренный этапом -----
  { id: 'sn-c2-1130', cameraId: 'c2', takenAt: at('15', '11:30'), imageUrl: img('gate-crane'), detections: gateCrane() },
  { id: 'sn-c2-1230', cameraId: 'c2', takenAt: at('15', '12:30'), imageUrl: img('gate-crane'), detections: gateCrane() },

  // ----- Камера 3, склад (объект 1): офлайн с утра, последний кадр 08:10 -----
  { id: 'sn-c3-0810', cameraId: 'c3', takenAt: at('15', '08:10'), imageUrl: img('gate-dumper'), detections: [
    det('excavator', 0.88, 16.5, 14, 24.5, 65), det('dump_truck', 0.93, 38, 13, 51, 65),
  ]},

  // ----- Камера 4, фундамент (объект 2): один бетоносмеситель вместо двух -----
  ...['10:30', '11:30', '12:30'].map((t) => (
    { id: `sn-c4-${t.replace(':', '')}`, cameraId: 'c4', takenAt: at('15', t), imageUrl: img('foundation-pump'), detections: foundationOneMixer() }
  )),

  // ----- Камера 5, въезд (объект 2): к 12:30 подъехал второй бетоносмеситель -----
  { id: 'sn-c5-1230', cameraId: 'c5', takenAt: at('15', '12:30'), imageUrl: img('gate-mixer'), detections: [det('mixer', 0.87, 34, 46, 18, 28, true)] },
  // вчера: экскаватор и кран-манипулятор на въезде (закрытое отклонение)
  { id: 'sn-c5-y1500', cameraId: 'c5', takenAt: at('14', '15:00'), imageUrl: img('gate-grabtruck'), detections: [
    det('excavator', 0.86, 60, 2, 25, 85), det('manipulator', 0.9, 47, 50, 30.5, 45),
  ]},

  // ----- Камера 6, дорога ПК 12 (объект 3): один каток вместо двух -----
  { id: 'sn-c6-1030', cameraId: 'c6', takenAt: at('15', '10:30'), imageUrl: img('road-roller-a'), detections: [det('roller', 0.92, 38, 42.5, 14.5, 25.5, true)] },
  { id: 'sn-c6-1130', cameraId: 'c6', takenAt: at('15', '11:30'), imageUrl: img('road-roller-b'), detections: [det('roller', 0.93, 40, 35, 15, 30.5, true)] },
  { id: 'sn-c6-1230', cameraId: 'c6', takenAt: at('15', '12:30'), imageUrl: img('road-roller-b'), detections: [det('roller', 0.93, 40, 35, 15, 30.5)] },

  // ----- Камера 7, дорога ПК 13 (объект 3): самосвал стоит без движения -----
  ...['10:30', '11:30', '12:30'].map((t) => (
    { id: `sn-c7-${t.replace(':', '')}`, cameraId: 'c7', takenAt: at('15', t), imageUrl: img('road-dumptruck'), detections: roadDumpTruck() }
  )),

  // ----- Камера 8, детсад (объект 4): всё по плану -----
  { id: 'sn-c8-1230', cameraId: 'c8', takenAt: at('15', '12:30'), imageUrl: img('yard-bulldozer'), detections: [det('bulldozer', 0.95, 12.5, 4, 82.5, 91, true)] },
]

/** Отдельные примеры для страницы проверки снимка (не входят в ленту камер) */
export const SAMPLE_SNAPSHOTS: Snapshot[] = [
  { id: 'sample-loading', cameraId: 'c1', takenAt: at('10', '11:00'), imageUrl: img('pit-loading'), detections: [
    det('excavator', 0.95, 7.5, 10, 48.5, 69, true), det('dump_truck', 0.94, 37, 45, 45.5, 44),
  ]},
  { id: 'sample-mixers', cameraId: 'c4', takenAt: at('10', '14:00'), imageUrl: img('foundation-mixers'), detections: [
    det('mixer', 0.91, 6, 37, 33, 32), det('mixer', 0.95, 44, 36, 46.5, 34),
  ]},
]
