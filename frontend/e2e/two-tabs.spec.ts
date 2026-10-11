import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, email: string): Promise<Page> {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('parking123')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByTestId('connection')).toHaveText('онлайн')
  return page
}

/**
 * TASK: «Занятость мест на схеме меняется у всех, кто её смотрит, без
 * обновления страницы». The operator drives the gate, the driver's map
 * changes by itself; afterwards the parking is left as it was.
 */
async function gateEntryChangesMapWithoutReload(operator: Page, driver: Page) {
  // Survives only if the page is never reloaded.
  await driver.evaluate(() => ((window as unknown as { marker: string }).marker = 'no-reload'))

  const plate = `E2E${Date.now() % 100000}`
  await operator.getByLabel('Номер машины').fill(plate)
  await operator.getByRole('button', { name: 'Заезд' }).click()
  const result = operator.getByRole('status')
  await expect(result).toContainText(`Заезд ${plate}: место`)
  const code = /место ([A-Z]\d{2})/.exec((await result.textContent()) ?? '')![1]

  await expect(driver.getByTestId(`spot-${code}`)).toHaveAttribute('data-state', 'occupied')
  expect(await driver.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe('no-reload')

  await operator.getByRole('button', { name: 'Выезд' }).click()
  await expect(result).toContainText(`Выезд ${plate}`)
  await expect(driver.getByTestId(`spot-${code}`)).not.toHaveAttribute('data-state', 'occupied')
}

test('two separate browsers: a gate entry changes the map without reload', async ({ browser }) => {
  const driver = await signIn(await (await browser.newContext()).newPage(), 'driver1@parking.local')
  const operator = await signIn(await (await browser.newContext()).newPage(), 'operator@parking.local')
  await gateEntryChangesMapWithoutReload(operator, driver)
})

/** D-032: two tabs of one browser keep their own accounts, also after a reload. */
test('two tabs of one browser: own account per tab, live map between them', async ({ context }) => {
  const operator = await signIn(await context.newPage(), 'operator@parking.local')
  const driver = await signIn(await context.newPage(), 'driver1@parking.local')

  await operator.reload()
  await driver.reload()
  await expect(operator.getByText('operator@parking.local')).toBeVisible()
  await expect(operator.getByRole('heading', { name: 'Симулятор шлагбаума' })).toBeVisible()
  await expect(driver.getByText('driver1@parking.local')).toBeVisible()
  await expect(driver.getByRole('heading', { name: /Мои брони/ })).toBeVisible()
  await expect(driver.getByTestId('connection')).toHaveText('онлайн')

  await gateEntryChangesMapWithoutReload(operator, driver)
})
