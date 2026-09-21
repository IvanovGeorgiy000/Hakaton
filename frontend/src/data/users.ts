import type { Role, User } from './types'

export const ROLES: Role[] = [
  {
    id: 'foreman',
    title: 'Прораб',
    subtitle: 'Я работаю на стройке',
    description: 'Вижу свой объект: что не так прямо сейчас, снимки с камер и план на неделю. Отвечаю на замечания.',
    siteId: 's1',
  },
  {
    id: 'manager',
    title: 'Руководитель проекта',
    subtitle: 'Я отвечаю за несколько объектов',
    description: 'Вижу все объекты сразу: где всё хорошо, а где нужно вмешаться. Слежу за сроками.',
  },
  {
    id: 'inspector',
    title: 'Инспектор',
    subtitle: 'Я проверяю подрядчиков',
    description: 'Работаю с журналом нарушений: смотрю доказательства, выдаю предписания, готовлю отчёты.',
  },
  {
    id: 'admin',
    title: 'Администратор',
    subtitle: 'Я настраиваю систему',
    description: 'Настраиваю правила «какой этап — какая техника», камеры и доступ сотрудников.',
  },
]

export const USERS: User[] = [
  { id: 'u1', name: 'Кузнецов Андрей', role: 'foreman', phone: '+7 916 123-45-67', siteIds: ['s1'] },
  { id: 'u2', name: 'Петров Сергей', role: 'foreman', phone: '+7 926 234-56-78', siteIds: ['s2'] },
  { id: 'u3', name: 'Волков Игорь', role: 'foreman', phone: '+7 903 345-67-89', siteIds: ['s3'] },
  { id: 'u4', name: 'Смирнова Ольга', role: 'foreman', phone: '+7 985 456-78-90', siteIds: ['s4'] },
  { id: 'u5', name: 'Иванова Мария', role: 'manager', phone: '+7 916 567-89-01', siteIds: ['s1', 's2', 's3', 's4'] },
  { id: 'u6', name: 'Соколов Дмитрий', role: 'inspector', phone: '+7 926 678-90-12', siteIds: ['s1', 's2', 's3', 's4'] },
  { id: 'u7', name: 'Орлов Павел', role: 'admin', phone: '+7 903 789-01-23', siteIds: [] },
]

/** Кто «вошёл» в демо под каждой ролью */
export const CURRENT_USER_BY_ROLE: Record<string, User> = {
  foreman: USERS[0],
  manager: USERS[4],
  inspector: USERS[5],
  admin: USERS[6],
}
