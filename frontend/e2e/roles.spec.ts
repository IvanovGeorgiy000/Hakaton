import { expect, test, type Page } from '@playwright/test'

/**
 * Смоук по ролям: вход одним нажатием, все экраны роли открываются без ошибок, главные действия откликаются.
 * Данные — демонстрационные, их наполняет сервер при запуске (см. playwright.config.ts).
 */

/** Ошибки страницы: необработанные исключения и сообщения об ошибках в консоли */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`исключение: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`консоль: ${message.text()}`)
  })
  return errors
}

async function enterAs(page: Page, role: string) {
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(`^${role}`) }).click()
  await expect(page.getByText('Быстрый вход без пароля')).toHaveCount(0)  // вошли: экрана входа больше нет
}

/** Открыть экран по адресу и дождаться его содержимого; экрана «Что-то пошло не так» быть не должно */
async function visit(page: Page, path: string, marker: string | RegExp) {
  await page.goto(path)
  await expect(page.getByText(marker).first()).toBeVisible()
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0)
}

test('прораб: свой объект, камеры, план; отклонение открывается и закрывается @телефон', async ({ page }) => {
  const errors = watchErrors(page)
  await enterAs(page, 'Прораб')
  await visit(page, '/foreman', 'Что не так прямо сейчас')
  await page.getByRole('button', { name: /Нет самосвалов/ }).first().click()
  const detail = page.getByRole('dialog')
  await expect(detail).toBeVisible()
  await expect(detail.getByText('Почему система так решила')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  await visit(page, '/foreman/cameras', 'Камера 1 — котлован')
  await visit(page, '/foreman/plan', 'Разработка котлована')
  expect(errors).toEqual([])
})

test('руководитель: объекты, страница объекта с вкладками, камеры, отклонения, отчёт, проверка фото', async ({ page }) => {
  const errors = watchErrors(page)
  await enterAs(page, 'Руководитель проекта')
  await visit(page, '/manager', 'ЖК «Северный парк», корпус 3')
  await visit(page, '/manager/site/s1', 'Этап сейчас')
  // пояснение «?» открывается нажатием и закрывается Escape; текст зачитывает и экранный диктор
  const tip = page.getByRole('button', { name: 'Как считается техника' })
  await tip.click()
  await expect(tip).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'Сколько техники нужно по правилу этапа' })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(tip).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('status').filter({ hasText: 'Сколько техники нужно по правилу этапа' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'План работ' }).click()
  await expect(page.getByRole('tab', { name: 'План работ' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Разработка котлована').first()).toBeVisible()
  await visit(page, '/manager/cameras', 'Камера 2 — въезд')
  await visit(page, '/manager/alerts', 'Нет самосвалов')
  await visit(page, '/manager/reports', 'Отчёт за неделю')
  await visit(page, '/manager/check', 'Проверить фото')
  expect(errors).toEqual([])
})

test('инспектор: журнал нарушений, форма предписания, отчёт', async ({ page }) => {
  const errors = watchErrors(page)
  await enterAs(page, 'Инспектор')
  await visit(page, '/inspector', 'Журнал нарушений')
  await page.getByRole('button', { name: /^Открыть нарушение/ }).first().click()
  await page.getByRole('button', { name: 'Выдать предписание…' }).first().click()
  const form = page.getByRole('dialog', { name: 'Выдать предписание' })
  await expect(form).toBeVisible()
  await expect(form.getByText('Срок устранения')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form).toHaveCount(0)
  await visit(page, '/inspector/cameras', 'Камера 1 — котлован')
  await visit(page, '/inspector/reports', 'Отчёт за неделю')
  expect(errors).toEqual([])
})

test('администратор: сотрудники с меню действий, правила, журнал действий, объекты', async ({ page }) => {
  const errors = watchErrors(page)
  await enterAs(page, 'Администратор')
  await visit(page, '/admin', 'ЖК «Северный парк», корпус 3')
  await visit(page, '/admin/manage/users', 'Сотрудники')
  // редкие действия — в меню «⋯»: открывается, фокус на первом пункте, Escape закрывает
  await page.getByRole('button', { name: /^Ещё действия:/ }).first().click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Сменить пароль' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await visit(page, '/admin/manage/rules', 'Правила: этап → техника')
  await visit(page, '/admin/manage/audit', 'Журнал действий')
  await visit(page, '/admin/site/s3', 'Этап сейчас')
  expect(errors).toEqual([])
})

test('страница /demo без входа: пример фото разбирается и сверяется с этапом', async ({ page }) => {
  const errors = watchErrors(page)
  await visit(page, '/demo', 'Снимок → техника → этап → отклонения')
  await page.getByRole('button', { name: 'Котлован: экскаватор и самосвал' }).click()
  await page.getByRole('button', { name: 'Распознать и сверить' }).click()
  await expect(page.getByText(/Анализатор: демонстрационный/)).toBeVisible()
  expect(errors).toEqual([])
})
