import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SeededScenario, StoreScope } from '../data/repositories'
import { buildCanonicalInitialOptions, calculateInitialImpact, loadInitialImpactSnapshot } from '../lib/impact/initialImpactService'
import { createQaSupplyCasesStore } from './test-environment'

const testScope: StoreScope = {
  tenantId: process.env.OM_QA_TENANT_ID ?? '17689e9c-e0ab-49cc-b2fd-260f1c5fa945',
  organizationId: process.env.OM_QA_ORGANIZATION_ID ?? '6fcb2379-eb38-480d-bf6f-26b08c2a7449',
}

const store = createQaSupplyCasesStore()

async function loginAndOpenCase(page: Page, caseId: string) {
  await page.goto(`/backend/supply-cases/${caseId}`)
  if (new URL(page.url()).pathname === '/login') {
    await page.getByLabel('Email').fill(process.env.OM_QA_EMAIL ?? 'admin@acme.com')
    await page.getByLabel('Password', { exact: true }).fill(process.env.OM_QA_PASSWORD ?? 'secret')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/backend(?:\/|$)/)
    await page.goto(`/backend/supply-cases/${caseId}`)
  }
  const dismissCookies = page.getByRole('button', { name: 'Dismiss', exact: true })
  if (await dismissCookies.count()) await dismissCookies.click()
}

test.describe('Supply cases actionable Phase 2 decision', () => {
  let scenario: SeededScenario

  test.beforeEach(async () => {
    scenario = await store.resetScenario(testScope)
    const loaded = await loadInitialImpactSnapshot(store, testScope, scenario.supplyCase.id)
    if (!loaded.ok) throw new Error(`[internal] Phase 2 browser fixture is incomplete: ${loaded.reasonCodes.join(',')}`)
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

  test('shows three unselected options and refetches after a guarded stale-version conflict', async ({ page }) => {
    await loginAndOpenCase(page, scenario.supplyCase.id)

    const decisionGroup = page.getByRole('radiogroup', { name: 'Choose a sourcing response' })
    const options = decisionGroup.getByRole('radio')
    await expect(options).toHaveCount(3)
    for (let index = 0; index < 3; index += 1) await expect(options.nth(index)).not.toBeChecked()

    const alternative = page.getByRole('radio', { name: 'Request a quote from Supplier 2' })
    await alternative.check()
    await expect(alternative).toBeChecked()

    await store.supplyCases.update(testScope, scenario.supplyCase.id, { needsAttentionReason: null })

    const decisionResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/supply_cases/${scenario.supplyCase.id}/decision`)
    ))
    const refreshedDetail = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes(`/api/supply_cases/${scenario.supplyCase.id}`)
      && response.status() === 200
    ))
    const mutationRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes(`/api/supply_cases/${scenario.supplyCase.id}`) && ['PATCH', 'PUT', 'POST', 'DELETE'].includes(request.method())) {
        mutationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`)
      }
    })
    await page.getByRole('button', { name: 'Apply selected option' }).click()

    expect((await decisionResponse).status()).toBe(409)
    const refreshed = await refreshedDetail
    expect((await refreshed.json()).case.status).toBe('AWAITING_SOURCING_DECISION')
    await expect(page.getByText('The decision could not be applied. The case has been refreshed.')).toBeVisible()
    await expect(decisionGroup.getByRole('radio')).toHaveCount(3)
    expect(mutationRequests).toEqual([`POST /api/supply_cases/${scenario.supplyCase.id}/decision`])
    await expect(page.getByText('Resolved', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Waiting for alternative offer', { exact: true })).toHaveCount(0)
  })
})
