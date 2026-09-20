import { test, expect, type Page } from '@playwright/test'

const email = process.env.SUPPLIER_DEMO_UI_EMAIL
const password = process.env.SUPPLIER_DEMO_UI_PASSWORD

test.skip(!email || !password, 'Set SUPPLIER_DEMO_UI_EMAIL and SUPPLIER_DEMO_UI_PASSWORD for authenticated UI coverage.')

async function signIn(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/login', { data: { email, password } })
  expect(response.ok()).toBeTruthy()
}

test('TEST-006 supply cases list renders loading, empty/error-capable table shell and filters', async ({ page }) => {
  await signIn(page)
  await page.goto('/backend/supplier-demo/supply-cases')
  await expect(page.getByRole('heading', { name: 'Supply cases' })).toBeVisible()
  await expect(page.getByPlaceholder(/search order/i)).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
  await page.getByPlaceholder(/search order/i).fill('SO-441')
  await expect(page.getByRole('row').filter({ hasText: 'SO-441' }).first()).toBeVisible()
  await page.screenshot({ path: '.ai/qa/test-results/supply-cases-list-light.png', fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: '.ai/qa/test-results/supply-cases-list-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '.ai/qa/test-results/supply-cases-list-narrow.png', fullPage: true })
})
