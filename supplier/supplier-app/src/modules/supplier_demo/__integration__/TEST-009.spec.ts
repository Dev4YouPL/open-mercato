import { test, expect, type Page } from '@playwright/test'

const email = process.env.SUPPLIER_DEMO_UI_EMAIL
const password = process.env.SUPPLIER_DEMO_UI_PASSWORD

test.skip(!email || !password, 'Set SUPPLIER_DEMO_UI_EMAIL and SUPPLIER_DEMO_UI_PASSWORD for authenticated UI coverage.')

async function signIn(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/login', { data: { email, password } })
  expect(response.ok()).toBeTruthy()
}

async function openReportForm(page: Page): Promise<void> {
  await page.goto('/backend/sales/orders')
  const orderRow = page.getByRole('row').filter({ hasText: /SO-441/ }).filter({ hasText: /confirmed/i }).first()
  await orderRow.getByRole('button', { name: /open actions/i }).click()
  await page.getByRole('menuitem', { name: /report supply disruption/i }).click()
  await page.waitForURL(/\/backend\/supplier-demo\/supply-cases\/report\?orderId=/)
}

test('TEST-009 fallback row action opens the report form, submits by keyboard and reports duplicate case conflict', async ({ page }) => {
  await signIn(page)
  await openReportForm(page)
  await expect(page.getByText(/does not change WMS stock or reservations/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: /SO-441/ })).toBeVisible()
  await page.screenshot({ path: '.ai/qa/test-results/report-disruption-form-light.png', fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: '.ai/qa/test-results/report-disruption-form-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '.ai/qa/test-results/report-disruption-form-narrow.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })

  const quantity = page.getByLabel(/quantity available/i)
  await quantity.focus()
  await quantity.fill('0')
  const created = page.waitForResponse((response) => response.url().includes('/report-disruption') && response.request().method() === 'POST')
  await quantity.press('Enter')
  expect((await created).status()).toBe(201)
  await page.waitForURL(/\/backend\/supplier-demo\/supply-cases$/)

  await openReportForm(page)
  const duplicate = page.waitForResponse((response) => response.url().includes('/report-disruption') && response.request().method() === 'POST')
  await page.getByLabel(/quantity available/i).fill('0')
  await page.getByLabel(/quantity available/i).press('Enter')
  expect((await duplicate).status()).toBe(409)
  await expect(page.getByText(/already exists/i)).toBeVisible()
})
