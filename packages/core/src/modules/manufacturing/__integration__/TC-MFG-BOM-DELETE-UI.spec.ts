import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { withBomFixtures } from '@open-mercato/core/helpers/integration/manufacturingFixtures'

export const integrationMeta = { dependsOnModules: ['manufacturing', 'catalog', 'wms', 'auth'] }

test('deletes an unused BOM family from its detail page after showing the scope', async ({ request, page }) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    await fixture.createItem(bomId, fixture.componentVariantId)
    await login(page, 'admin')
    await page.goto(`/backend/manufacturing/boms/${bomId}`)
    await page.getByRole('button', { name: /Delete entire BOM|Usuń cały BOM/i }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(fixture.outputName)
    const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === '/api/manufacturing/boms/delete-all')
    await dialog.getByRole('button', { name: /Delete|Usuń/i }).click()
    expect((await response).status()).toBe(200)
    await expect(page).toHaveURL(/\/backend\/manufacturing\/boms$/)
  })
})
