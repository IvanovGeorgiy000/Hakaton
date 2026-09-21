import type { Stage } from './types'

/**
 * Календарный план (уровень 1 → уровень 2), как в примере из ТЗ (CSV/Excel).
 * Сегодня в демо — 15.09.2026.
 */
export const STAGES: Stage[] = [
  // ---------- Объект 1: ЖК «Северный парк» ----------
  { id: 's1-l1-prep', siteId: 's1', level: 1, name: 'Подготовительный период', start: '2026-08-03', end: '2026-08-21', status: 'done' },
  { id: 's1-prep', siteId: 's1', parentId: 's1-l1-prep', level: 2, name: 'Подготовка площадки', start: '2026-08-03', end: '2026-08-21', status: 'done', ruleKey: 'site_prep' },
  { id: 's1-l1-earth', siteId: 's1', level: 1, name: 'Земляные работы', start: '2026-08-24', end: '2026-10-02', status: 'in_progress' },
  { id: 's1-excavation', siteId: 's1', parentId: 's1-l1-earth', level: 2, name: 'Разработка котлована', start: '2026-08-24', end: '2026-09-25', status: 'in_progress', ruleKey: 'excavation' },
  { id: 's1-soil', siteId: 's1', parentId: 's1-l1-earth', level: 2, name: 'Вывоз грунта', start: '2026-09-21', end: '2026-10-02', status: 'planned', ruleKey: 'soil_removal' },
  { id: 's1-l1-found', siteId: 's1', level: 1, name: 'Нулевой цикл', start: '2026-10-05', end: '2026-11-27', status: 'planned' },
  { id: 's1-found', siteId: 's1', parentId: 's1-l1-found', level: 2, name: 'Бетонирование фундаментной плиты', start: '2026-10-05', end: '2026-11-06', status: 'planned', ruleKey: 'foundation_concrete' },
  { id: 's1-backfill', siteId: 's1', parentId: 's1-l1-found', level: 2, name: 'Обратная засыпка', start: '2026-11-09', end: '2026-11-27', status: 'planned', ruleKey: 'backfill' },
  { id: 's1-l1-frame', siteId: 's1', level: 1, name: 'Надземная часть', start: '2026-11-30', end: '2027-05-14', status: 'planned' },
  { id: 's1-frame', siteId: 's1', parentId: 's1-l1-frame', level: 2, name: 'Монтаж каркаса', start: '2026-11-30', end: '2027-05-14', status: 'planned', ruleKey: 'frame_assembly' },

  // ---------- Объект 2: Школа ----------
  { id: 's2-l1-prep', siteId: 's2', level: 1, name: 'Подготовительный период', start: '2026-06-01', end: '2026-06-19', status: 'done' },
  { id: 's2-prep', siteId: 's2', parentId: 's2-l1-prep', level: 2, name: 'Подготовка площадки', start: '2026-06-01', end: '2026-06-19', status: 'done', ruleKey: 'site_prep' },
  { id: 's2-l1-earth', siteId: 's2', level: 1, name: 'Земляные работы', start: '2026-06-22', end: '2026-08-14', status: 'done' },
  { id: 's2-excavation', siteId: 's2', parentId: 's2-l1-earth', level: 2, name: 'Разработка котлована', start: '2026-06-22', end: '2026-08-14', status: 'done', ruleKey: 'excavation' },
  { id: 's2-l1-found', siteId: 's2', level: 1, name: 'Нулевой цикл', start: '2026-08-17', end: '2026-10-30', status: 'in_progress' },
  { id: 's2-foundation', siteId: 's2', parentId: 's2-l1-found', level: 2, name: 'Бетонирование фундаментной плиты', start: '2026-08-17', end: '2026-10-09', status: 'in_progress', ruleKey: 'foundation_concrete' },
  { id: 's2-backfill', siteId: 's2', parentId: 's2-l1-found', level: 2, name: 'Обратная засыпка', start: '2026-10-12', end: '2026-10-30', status: 'planned', ruleKey: 'backfill' },
  { id: 's2-l1-frame', siteId: 's2', level: 1, name: 'Надземная часть', start: '2026-11-02', end: '2027-04-30', status: 'planned' },
  { id: 's2-frame', siteId: 's2', parentId: 's2-l1-frame', level: 2, name: 'Монтаж каркаса', start: '2026-11-02', end: '2027-04-30', status: 'planned', ruleKey: 'frame_assembly' },

  // ---------- Объект 3: Дорога ----------
  { id: 's3-l1-prep', siteId: 's3', level: 1, name: 'Подготовительный период', start: '2026-07-06', end: '2026-07-17', status: 'done' },
  { id: 's3-prep', siteId: 's3', parentId: 's3-l1-prep', level: 2, name: 'Подготовка площадки', start: '2026-07-06', end: '2026-07-17', status: 'done', ruleKey: 'site_prep' },
  { id: 's3-l1-base', siteId: 's3', level: 1, name: 'Дорожная одежда', start: '2026-07-20', end: '2026-10-09', status: 'in_progress' },
  { id: 's3-base', siteId: 's3', parentId: 's3-l1-base', level: 2, name: 'Устройство основания дороги', start: '2026-07-20', end: '2026-09-04', status: 'done', ruleKey: 'road_base' },
  { id: 's3-asphalt', siteId: 's3', parentId: 's3-l1-base', level: 2, name: 'Укладка асфальта', start: '2026-09-07', end: '2026-10-09', status: 'in_progress', ruleKey: 'asphalt' },
  { id: 's3-l1-land', siteId: 's3', level: 1, name: 'Благоустройство', start: '2026-10-12', end: '2026-11-13', status: 'planned' },
  { id: 's3-land', siteId: 's3', parentId: 's3-l1-land', level: 2, name: 'Благоустройство', start: '2026-10-12', end: '2026-11-13', status: 'planned', ruleKey: 'landscaping' },

  // ---------- Объект 4: Детский сад ----------
  { id: 's4-l1-prep', siteId: 's4', level: 1, name: 'Подготовительный период', start: '2026-09-01', end: '2026-09-25', status: 'in_progress' },
  { id: 's4-prep', siteId: 's4', parentId: 's4-l1-prep', level: 2, name: 'Подготовка площадки', start: '2026-09-01', end: '2026-09-25', status: 'in_progress', ruleKey: 'site_prep' },
  { id: 's4-l1-earth', siteId: 's4', level: 1, name: 'Земляные работы', start: '2026-09-28', end: '2026-11-06', status: 'planned' },
  { id: 's4-excavation', siteId: 's4', parentId: 's4-l1-earth', level: 2, name: 'Разработка котлована', start: '2026-09-28', end: '2026-10-23', status: 'planned', ruleKey: 'excavation' },
  { id: 's4-soil', siteId: 's4', parentId: 's4-l1-earth', level: 2, name: 'Вывоз грунта', start: '2026-10-19', end: '2026-11-06', status: 'planned', ruleKey: 'soil_removal' },
]
