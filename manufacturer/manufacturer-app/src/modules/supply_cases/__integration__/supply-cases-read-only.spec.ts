import { expect, test, type Page } from '@playwright/test'
import {
  FIXTURE_CORRELATION_ID,
  FIXTURE_DATES,
  FIXTURE_MATERIAL_SKU,
  FIXTURE_PARTICIPANTS,
  FIXTURE_PROPOSAL_SANITIZED_BODY,
} from '../data/fixtures'
import type { SeededScenario, StoreScope } from '../data/repositories'
import { createQaSupplyCasesStore } from './test-environment'

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
  }
  const dismissCookies = page.getByRole('button', { name: 'Dismiss', exact: true })
  if (await dismissCookies.count()) await dismissCookies.click()
  await expect(page.getByRole('heading', { name: 'Supply cases', exact: true }).first()).toBeVisible()
}

test.describe('Supply cases read-only UI', () => {
  let scenario: SeededScenario

  test.beforeEach(async ({ page }) => {
    scenario = await store.resetScenario(testScope)
    await store.productionPlans.update(testScope, scenario.productionPlan.id, {
      internalStockQuantity: 0,
      riskStatus: 'AT_RISK',
      supplierCommitments: [
        {
          supplierEmail: FIXTURE_PARTICIPANTS.supplier1,
          quantity: 300,
          deliveryDate: FIXTURE_DATES.wednesday,
          status: 'COMMITTED',
        },
      ],
    })
    await openSupplyCasesList(page)
  })

  test.afterEach(async () => {
    await store.purgeScope(testScope)
  })

  test('filters a supply case by order and risk, then opens its read-only detail', async ({ page }, testInfo) => {
    const searchBox = page.getByRole('searchbox', { name: 'Search by case, order, SKU or supplier' })
    await searchBox.fill(scenario.productionOrder.orderNumber)
    await expect(page.getByRole('link', { name: scenario.supplyCase.correlationId, exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('checkbox', { name: 'At risk', exact: true }).check()
    await page.getByRole('button', { name: 'Apply', exact: true }).last().click()

    await expect(page).toHaveURL(/riskStatus=AT_RISK/)
    await expect(page.getByRole('link', { name: scenario.supplyCase.correlationId, exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('supply-cases-list.png'), fullPage: true })

    await page.goto(`/backend/supply-cases/${scenario.supplyCase.id}`)
    await expect(page.getByRole('heading', { name: scenario.supplyCase.correlationId, exact: true })).toBeVisible()
    await expect(page.getByText('300/500', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('At risk', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Case created', { exact: true })).toBeVisible()
    await expect(page.getByText(FIXTURE_PROPOSAL_SANITIZED_BODY, { exact: true })).toBeVisible()
    await expect(page.getByText('W dniu 2026-09-10 manufacturer@hackon-om-wro.cloud napisal:', { exact: true })).toHaveCount(0)
    await expect(page.getByText('supply_cases.', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Edytuj|Usuń/i })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('supply-case-detail.png'), fullPage: true })
  })

  test('shows an explicit empty state for a search with no matching case', async ({ page }) => {
    const searchBox = page.getByRole('searchbox', { name: 'Search by case, order, SKU or supplier' })
    await searchBox.fill('NO-SUCH-SUPPLY-CASE')
    await expect(page.getByText('No results found', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: scenario.supplyCase.correlationId, exact: true })).toHaveCount(0)
  })

  test('keeps the fixture identifiers visible in the operational row', async ({ page }) => {
    const row = page.getByRole('row', { name: new RegExp(FIXTURE_CORRELATION_ID) })
    await expect(row).toContainText(FIXTURE_CORRELATION_ID)
    await expect(row).toContainText(FIXTURE_MATERIAL_SKU)
    await expect(row).toContainText(scenario.productionOrder.orderNumber)
  })
})
