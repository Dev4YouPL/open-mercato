import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createQaSupplyCasesStore } from './test-environment'
import { buildCanonicalInitialOptions, calculateInitialImpact, loadInitialImpactSnapshot } from '../lib/impact/initialImpactService'
import type { SeededScenario, StoreScope } from '../data/repositories'

const testScope: StoreScope = {
  tenantId: process.env.OM_QA_TENANT_ID ?? '17689e9c-e0ab-49cc-b2fd-260f1c5fa945',
  organizationId: process.env.OM_QA_ORGANIZATION_ID ?? '6fcb2379-eb38-480d-bf6f-26b08c2a7449',
}

const store = createQaSupplyCasesStore()

async function login(page: Page) {
  await page.goto('/backend/supply-cases')
  if (new URL(page.url()).pathname === '/login') {
    await page.getByLabel('Email').fill(process.env.OM_QA_EMAIL ?? 'admin@acme.com')
    await page.getByLabel('Password', { exact: true }).fill(process.env.OM_QA_PASSWORD ?? 'secret')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/backend(?:\/|$)/)
    await page.goto('/backend/supply-cases')
  }
  await expect(page).toHaveURL(/\/backend(?:\/|$)/)
}

test.describe('Supply cases narrow and keyboard UI', () => {
  let scenario: SeededScenario

  test.beforeEach(async () => {
    scenario = await store.resetScenario(testScope)
    const loaded = await loadInitialImpactSnapshot(store, testScope, scenario.supplyCase.id)
    if (!loaded.ok) throw new Error(`[internal] Accessibility fixture is incomplete: ${loaded.reasonCodes.join(',')}`)
    const impact = calculateInitialImpact(loaded.snapshot)
    const options = buildCanonicalInitialOptions(loaded.snapshot, impact)
    await store.supplyCases.update(testScope, scenario.supplyCase.id, {
      status: 'AWAITING_SOURCING_DECISION',
      initialOptions: options,
      initialFactsHash: options[0].factsHash,
      initialProposalId: randomUUID(),
    })
  })

  test.afterEach(async () => {
    await store.purgeScope(testScope)
  })

  test('TEST-UI-012: narrow viewport supports keyboard navigation, labels, focus, and no critical overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    await page.goto(`/backend/supply-cases/${scenario.supplyCase.id}`)
    await expect(page.getByRole('heading', { name: scenario.supplyCase.correlationId, exact: true })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Choose a sourcing response' })).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Apply selected option', exact: true })).toBeDisabled()

    const hasCriticalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(hasCriticalOverflow).toBe(false)
    await expect.poll(async () => page.evaluate(() => document.activeElement?.textContent ?? '')).toContain(scenario.supplyCase.correlationId)

    const radios = page.getByRole('radio')
    await radios.first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(radios.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(radios.nth(2)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(page.getByRole('radio', { name: 'Request a quote from Supplier 2' })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Apply selected option', exact: true })).toBeEnabled()
  })
})
