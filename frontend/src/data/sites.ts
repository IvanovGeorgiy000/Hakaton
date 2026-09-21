import type { Camera, Site, Zone } from './types'

export const SITES: Site[] = [
  {
    id: 's1',
    name: 'ЖК «Северный парк», корпус 3',
    address: 'ул. Дыбенко, вл. 7, САО',
    contractor: 'ООО «МонолитСтрой»',
    foreman: 'Кузнецов Андрей',
    currentStageId: 's1-excavation',
    planProgress: 41,
    factProgress: 34,
  },
  {
    id: 's2',
    name: 'Школа на 550 мест',
    address: 'ул. Лобачевского, 92, ЗАО',
    contractor: 'АО «Стройтрест-11»',
    foreman: 'Петров Сергей',
    currentStageId: 's2-foundation',
    planProgress: 58,
    factProgress: 57,
  },
  {
    id: 's3',
    name: 'Реконструкция Дмитровского шоссе, участок 2',
    address: 'Дмитровское ш., км 12–14, САО',
    contractor: 'ГБУ «Автомобильные дороги»',
    foreman: 'Волков Игорь',
    currentStageId: 's3-asphalt',
    planProgress: 73,
    factProgress: 66,
  },
  {
    id: 's4',
    name: 'Детский сад на 250 мест',
    address: 'ул. Рождественская, 21, Некрасовка',
    contractor: 'ООО «ГорСтройКомплект»',
    foreman: 'Смирнова Ольга',
    currentStageId: 's4-prep',
    planProgress: 12,
    factProgress: 14,
  },
]

export const ZONES: Zone[] = [
  { id: 'z1-pit', siteId: 's1', name: 'Котлован, оси А–Д' },
  { id: 'z1-gate', siteId: 's1', name: 'Въезд и мойка колёс' },
  { id: 'z1-yard', siteId: 's1', name: 'Склад материалов' },
  { id: 'z2-found', siteId: 's2', name: 'Фундаментная плита, блок Б' },
  { id: 'z2-gate', siteId: 's2', name: 'Въезд' },
  { id: 'z3-road', siteId: 's3', name: 'Полоса 1–2, ПК 12+00' },
  { id: 'z3-road2', siteId: 's3', name: 'Полоса 3–4, ПК 13+50' },
  { id: 'z4-yard', siteId: 's4', name: 'Стройплощадка, общий вид' },
]

export const CAMERAS: Camera[] = [
  { id: 'c1', siteId: 's1', zoneId: 'z1-pit', name: 'Камера 1 — котлован', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'pit' },
  { id: 'c2', siteId: 's1', zoneId: 'z1-gate', name: 'Камера 2 — въезд', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'entrance' },
  { id: 'c3', siteId: 's1', zoneId: 'z1-yard', name: 'Камера 3 — склад', online: false, lastSnapshotAt: '2026-09-15T08:10:00+03:00', scene: 'yard' },
  { id: 'c4', siteId: 's2', zoneId: 'z2-found', name: 'Камера 1 — фундамент', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'foundation' },
  { id: 'c5', siteId: 's2', zoneId: 'z2-gate', name: 'Камера 2 — въезд', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'entrance' },
  { id: 'c6', siteId: 's3', zoneId: 'z3-road', name: 'Камера 1 — ПК 12', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'road' },
  { id: 'c7', siteId: 's3', zoneId: 'z3-road2', name: 'Камера 2 — ПК 13', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'road' },
  { id: 'c8', siteId: 's4', zoneId: 'z4-yard', name: 'Камера 1 — общий вид', online: true, lastSnapshotAt: '2026-09-15T12:30:00+03:00', scene: 'yard' },
]
