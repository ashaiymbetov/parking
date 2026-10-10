import { expect, test, type Browser, type Page } from '@playwright/test'

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('parking123')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByTestId('connection')).toHaveText('онлайн')
  return page
}

/**
 * TASK: «Занятость мест на схеме меняется у всех, кто её смотрит, без
 * обновления страницы». Two independent browser contexts: the operator
 * drives the gate in one, the driver's map in the other changes by itself.
 */
test('a gate entry in one tab changes the map in another without reload', async ({ browser }) => {
  const driver = await signIn(browser, 'driver1@parking.local')
  const operator = await signIn(browser, 'operator@parking.local')

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

  // Leave the parking as it was, and see the spot come back.
  await operator.getByRole('button', { name: 'Выезд' }).click()
  await expect(result).toContainText(`Выезд ${plate}`)
  await expect(driver.getByTestId(`spot-${code}`)).not.toHaveAttribute('data-state', 'occupied')
})
