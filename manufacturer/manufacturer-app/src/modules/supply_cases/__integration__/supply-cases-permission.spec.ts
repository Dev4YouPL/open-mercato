import { expect, test, type Page } from '@playwright/test'
import { createQaSupplyCasesStore } from './test-environment'
import type { SeededScenario, StoreScope } from '../data/repositories'

const testScope: StoreScope = {
  tenantId: process.env.OM_QA_TENANT_ID ?? '17689e9c-e0ab-49cc-b2fd-260f1c5fa945',
  organizationId: process.env.OM_QA_ORGANIZATION_ID ?? '6fcb2379-eb38-480d-bf6f-26b08c2a7449',
}

const store = createQaSupplyCasesStore()

async function loginAsEmployee(page: Page) {
  await page.goto('/login?role=employee')
  await page.getByLabel('Email').fill('employee@acme.com')
  await page.getByLabel('Password', { exact: true }).fill('secret')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/backend(?:\/|$)/)
}

test.describe('Supply cases permission boundary', () => {
  let scenario: SeededScenario

  test.beforeEach(async () => {
    scenario = await store.resetScenario(testScope)
  })

  test.afterEach(async () => {
    await store.purgeScope(testScope)
  })

  test('TEST-UI-009: a forbidden operator gets a standard denied state without case data', async ({ page }) => {
    await loginAsEmployee(page)

    await page.goto('/backend/supply-cases')
    await expect(page.getByText('Access Denied', { exact: true })).toBeVisible()
    await expect(page.getByText(scenario.supplyCase.correlationId, { exact: true })).toHaveCount(0)

    await page.goto(`/backend/supply-cases/${scenario.supplyCase.id}`)
    await expect(page.getByText('Access Denied', { exact: true })).toBeVisible()
    await expect(page.getByText(scenario.supplyCase.correlationId, { exact: true })).toHaveCount(0)
  })
})
