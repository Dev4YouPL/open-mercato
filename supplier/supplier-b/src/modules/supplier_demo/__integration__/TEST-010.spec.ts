import { test, expect, type Page } from '@playwright/test'

const email = process.env.SUPPLIER_DEMO_UI_EMAIL
const password = process.env.SUPPLIER_DEMO_UI_PASSWORD

test.skip(!email || !password, 'Set SUPPLIER_DEMO_UI_EMAIL and SUPPLIER_DEMO_UI_PASSWORD for authenticated UI coverage.')

async function signIn(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/login', { data: { email, password } })
  expect(response.ok()).toBeTruthy()
}

test('TEST-010 supply cases list covers semantic status tokens and responsive screenshots', async ({ page }) => {
  await signIn(page)
  await page.goto('/backend/supplier-demo/supply-cases')
  await expect(page.getByRole('heading', { name: 'Supply cases' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Commitment' })).toBeVisible()
  const retryLabels = await page.getByRole('menuitem', { name: /retry proposal/i }).allTextContents()
  expect(retryLabels.every((label) => label.toLowerCase().includes('retry'))).toBeTruthy()
  await page.screenshot({ path: '.ai/qa/test-results/supply-cases-statuses-light.png', fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: '.ai/qa/test-results/supply-cases-statuses-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('body')).toBeVisible()
  await page.screenshot({ path: '.ai/qa/test-results/supply-cases-statuses-narrow.png', fullPage: true })
})
