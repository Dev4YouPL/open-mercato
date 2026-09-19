import { expect, test, type Page } from '@playwright/test'
import { createQaSupplyCasesStore } from './test-environment'
import type { SeededScenario, StoreScope } from '../data/repositories'

const testScope: StoreScope = {
  tenantId: process.env.OM_QA_TENANT_ID ?? '17689e9c-e0ab-49cc-b2fd-260f1c5fa945',
  organizationId: process.env.OM_QA_ORGANIZATION_ID ?? '6fcb2379-eb38-480d-bf6f-26b08c2a7449',
}

const store = createQaSupplyCasesStore()

async function openSupplyCasesList(page: Page) {
  await page.goto('/backend/supply-cases')
  if (new URL(page.url()).pathname === '/login') {
    await page.getByLabel('Email').fill(process.env.OM_QA_EMAIL ?? 'admin@acme.com')
    await page.getByLabel('Password', { exact: true }).fill(process.env.OM_QA_PASSWORD ?? 'secret')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/backend(?:\/|$)/)
    await page.goto('/backend/supply-cases')
  }
  await expect(page.getByRole('heading', { name: 'Supply cases', exact: true }).first()).toBeVisible()
}

test.describe('Supply cases failure and degraded states', () => {
  let scenario: SeededScenario

  test.beforeEach(async () => {
    scenario = await store.resetScenario(testScope)
  })

  test.afterEach(async () => {
    await store.purgeScope(testScope)
  })

  test('TEST-UI-010: list error exposes retry and recovers without stale data', async ({ page }) => {
    let failedRequests = 0
    let allowRecovery = false
    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.pathname === '/api/supply_cases' && route.request().method() === 'GET' && !allowRecovery) {
        failedRequests += 1
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal_error' }) })
        return
      }
      await route.continue()
    })

    await openSupplyCasesList(page)
    await expect(page.getByText('Supply cases could not be loaded.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()

    allowRecovery = true
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('link', { name: scenario.supplyCase.correlationId, exact: true })).toBeVisible()
    expect(failedRequests).toBeGreaterThan(0)
  })

  test('TEST-UI-010: detail keeps usable sections visible in a degraded partial state and handles 404', async ({ page }) => {
    await store.supplyCases.update(testScope, scenario.supplyCase.id, {
      productionPlanId: 'missing-production-plan',
      productionOrderIds: ['missing-production-order'],
    })

    await openSupplyCasesList(page)
    await page.goto(`/backend/supply-cases/${scenario.supplyCase.id}`)
    await expect(page.getByText('The related production plan is unavailable.', { exact: true })).toBeVisible()
    await expect(page.getByText('1 related production order(s) could not be loaded.', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Messages and timeline', exact: true })).toBeVisible()

    const missingResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/supply_cases/not-a-real-case')
      && response.status() === 404
    ))
    await page.goto('/backend/supply-cases/not-a-real-case')
    expect((await missingResponse).status()).toBe(404)
    await expect(page.getByText('Supply case could not be loaded.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await expect(page.getByText('The related production plan is unavailable.', { exact: true })).toHaveCount(0)
  })
})
