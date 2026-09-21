import type { Rule, RuleKey } from './types'

/**
 * Методика сопоставления «этап работ → необходимая техника».
 * Это и есть «правила», по которым система решает, есть ли отклонение.
 * Администратор может менять их в интерфейсе.
 */
export const RULES: Record<RuleKey, Rule> = {
  site_prep: {
    key: 'site_prep',
    stageName: 'Подготовка площадки',
    description: 'Расчистка, планировка, ограждение, временные дороги.',
    required: [
      { type: 'bulldozer', min: 1, why: 'Планировка и расчистка территории' },
    ],
    allowed: ['truck', 'excavator', 'dump_truck', 'manipulator'],
    unexpected: [
      { type: 'mixer', why: 'Бетонные работы на этом этапе не запланированы' },
      { type: 'roller', why: 'Уплотнение покрытия выполняется позже' },
    ],
    confirmAfterSnapshots: 3,
  },
  excavation: {
    key: 'excavation',
    stageName: 'Разработка котлована',
    description: 'Выемка грунта экскаватором и вывоз самосвалами.',
    required: [
      { type: 'excavator', min: 1, why: 'Без экскаватора выемка грунта не ведётся' },
      { type: 'dump_truck', min: 2, why: 'Иначе экскаватор простаивает в ожидании вывоза' },
    ],
    allowed: ['bulldozer', 'truck'],
    unexpected: [
      { type: 'crane', why: 'Монтаж на этапе котлована не предусмотрен графиком' },
      { type: 'mixer', why: 'Бетонирование начинается после устройства основания' },
      { type: 'roller', why: 'Уплотнение не входит в этап' },
    ],
    confirmAfterSnapshots: 3,
  },
  soil_removal: {
    key: 'soil_removal',
    stageName: 'Вывоз грунта',
    description: 'Транспортировка грунта за пределы площадки.',
    required: [
      { type: 'dump_truck', min: 2, why: 'Основная работа этапа — вывоз' },
      { type: 'excavator', min: 1, why: 'Погрузка грунта' },
    ],
    allowed: ['bulldozer'],
    unexpected: [{ type: 'mixer', why: 'Бетонные работы не запланированы' }],
    confirmAfterSnapshots: 3,
  },
  backfill: {
    key: 'backfill',
    stageName: 'Обратная засыпка',
    description: 'Засыпка пазух котлована с уплотнением.',
    required: [
      { type: 'bulldozer', min: 1, why: 'Разравнивание грунта' },
      { type: 'roller', min: 1, why: 'Послойное уплотнение' },
    ],
    allowed: ['dump_truck', 'excavator'],
    unexpected: [{ type: 'mixer', why: 'Бетонирование на этапе не предусмотрено' }],
    confirmAfterSnapshots: 3,
  },
  foundation_concrete: {
    key: 'foundation_concrete',
    stageName: 'Бетонирование фундаментной плиты',
    description: 'Подача и укладка бетона, армирование.',
    required: [
      { type: 'mixer', min: 2, why: 'Непрерывная подача бетона без «холодных швов»' },
    ],
    allowed: ['crane', 'manipulator', 'truck'],
    unexpected: [
      { type: 'excavator', why: 'Земляные работы должны быть завершены' },
      { type: 'roller', why: 'Не применяется при бетонировании' },
    ],
    confirmAfterSnapshots: 2,
  },
  frame_assembly: {
    key: 'frame_assembly',
    stageName: 'Монтаж каркаса',
    description: 'Монтаж конструкций надземной части.',
    required: [
      { type: 'crane', min: 1, why: 'Подъём и монтаж конструкций' },
      { type: 'truck', min: 1, why: 'Поставка конструкций' },
    ],
    allowed: ['manipulator', 'mixer'],
    unexpected: [
      { type: 'excavator', why: 'Земляные работы завершены' },
      { type: 'bulldozer', why: 'Не применяется на этапе' },
    ],
    confirmAfterSnapshots: 3,
  },
  road_base: {
    key: 'road_base',
    stageName: 'Устройство основания дороги',
    description: 'Отсыпка и уплотнение щебёночного основания.',
    required: [
      { type: 'dump_truck', min: 2, why: 'Подвоз щебня' },
      { type: 'bulldozer', min: 1, why: 'Разравнивание' },
      { type: 'roller', min: 1, why: 'Уплотнение основания' },
    ],
    allowed: ['excavator', 'truck'],
    unexpected: [{ type: 'mixer', why: 'Бетон на этапе не применяется' }],
    confirmAfterSnapshots: 3,
  },
  asphalt: {
    key: 'asphalt',
    stageName: 'Укладка асфальта',
    description: 'Укладка и уплотнение асфальтобетонной смеси.',
    required: [
      { type: 'roller', min: 2, why: 'Без укатки асфальт теряет качество за считанные минуты' },
      { type: 'dump_truck', min: 1, why: 'Подвоз горячей смеси' },
    ],
    allowed: ['truck'],
    unexpected: [
      { type: 'excavator', why: 'Земляные работы должны быть завершены' },
      { type: 'crane', why: 'Не применяется при укладке' },
    ],
    confirmAfterSnapshots: 2,
  },
  landscaping: {
    key: 'landscaping',
    stageName: 'Благоустройство',
    description: 'Озеленение, малые формы, тротуары.',
    required: [
      { type: 'manipulator', min: 1, why: 'Разгрузка плитки и малых форм' },
    ],
    allowed: ['truck', 'excavator', 'roller', 'dump_truck'],
    unexpected: [{ type: 'crane', why: 'Тяжёлый монтаж завершён' }],
    confirmAfterSnapshots: 3,
  },
}
