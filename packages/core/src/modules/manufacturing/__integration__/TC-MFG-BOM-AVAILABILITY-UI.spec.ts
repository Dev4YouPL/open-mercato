import { expect, test } from '@playwright/test'

import { login } from '@open-mercato/core/helpers/integration/auth'
import { withBomFixtures } from '@open-mercato/core/helpers/integration/manufacturingFixtures'

export const integrationMeta = {
  dependsOnModules: ['manufacturing', 'catalog', 'wms', 'auth'],
}

const toggleName = /Dostępna dla nowych zleceń produkcyjnych|Available for new production orders/i
const unavailableLabel = /Niedostępny|Unavailable/i

test('manages availability from released BOM details while keeping the revision read-only', async ({ request, page }) => {
  await withBomFixtures(request, async (fixture) => {
    const draftId = await fixture.createBom()
    await fixture.createItem(draftId, fixture.componentVariantId)
    expect((await fixture.release(draftId)).status()).toBe(200)
    await login(page, 'admin')
    await page.goto(`/backend/manufacturing/boms/${draftId}`)

    const toggle = page.getByRole('switch', { name: toggleName })
    await expect(toggle).toBeVisible()
    await expect(toggle).toBeChecked()
    await expect(page.getByLabel(/Base quantity|Ilość bazowa/i)).toBeDisabled()

    const withdrawResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/manufacturing/boms/availability')
    await toggle.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Wycofaj|Withdraw/i }).click()
    expect((await withdrawResponse).status()).toBe(200)
    await expect(toggle).not.toBeChecked()
    await expect(page.getByText(unavailableLabel)).toBeVisible()

    const enableResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/manufacturing/boms/availability')
    await toggle.click()
    expect((await enableResponse).status()).toBe(200)
    await expect(toggle).toBeChecked()
    await expect(dialog).not.toBeVisible()

    const availableBom = await fixture.readBom(draftId)
    expect((await fixture.setAvailability(draftId, false, availableBom.updatedAt)).status()).toBe(200)
    await page.goto('/backend/manufacturing/boms')
    const search = page.getByPlaceholder(/Szukaj po nazwie wariantu|Search by variant name/i)
    const listResponse = page.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/manufacturing/boms'
      && new URL(response.url()).searchParams.get('search') === fixture.outputName)
    await search.fill(fixture.outputName)
    expect((await listResponse).status()).toBe(200)
    const withdrawnRow = page.getByRole('row', { name: new RegExp(fixture.outputName) })
    await expect(withdrawnRow.getByText(unavailableLabel)).toBeVisible()

    const draft = await fixture.createBom()
    await page.goto(`/backend/manufacturing/boms/${draft}`)
    await expect(page.getByRole('switch', { name: toggleName })).toHaveCount(0)
  })
})
