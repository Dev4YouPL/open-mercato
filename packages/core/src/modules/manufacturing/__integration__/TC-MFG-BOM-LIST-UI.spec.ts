import {
  expect,
  test,
  type Page,
} from '@playwright/test'

import {
  login,
} from '@open-mercato/core/helpers/integration/auth'
import {
  withBomFixtures,
} from '@open-mercato/core/helpers/integration/manufacturingFixtures'

export const integrationMeta = {
  dependsOnModules: [
    'manufacturing',
    'catalog',
    'wms',
    'auth',
  ],
}

const draftStatus = /^(Robocza|Draft)$/
const releasedStatus = /^(Wydana|Released)$/
const incompleteStatus = /^(Niekompletna|Incomplete)$/
const availableLabel = /^(Dostępny|Available)$/
const unavailableLabel = /^(Niedostępny|Unavailable)$/
const searchPlaceholder =
  /Szukaj po nazwie wariantu|Search by variant name/

function waitForBomList(page: Page, search?: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())

    return response.request().method() === 'GET'
      && url.pathname === '/api/manufacturing/boms'
      && (search === undefined || url.searchParams.get('search') === search)
  })
}

async function searchBoms(page: Page, term: string): Promise<void> {
  const responsePromise = waitForBomList(page, term)

  await page.getByPlaceholder(searchPlaceholder).fill(term)

  expect((await responsePromise).status()).toBe(200)
}

test('lists BOMs with variant, status and availability and narrows by search', async ({
  request,
  page,
}) => {
  await withBomFixtures(request, async (fixture) => {
    await fixture.createBom()

    const releasedBomId = await fixture.createBom(fixture.alternateVariantId)

    await fixture.createItem(releasedBomId, fixture.componentVariantId)
    expect((await fixture.release(releasedBomId)).status()).toBe(200)

    await login(page, 'admin')

    const initialList = waitForBomList(page)

    await page.goto('/backend/manufacturing/boms')
    expect((await initialList).status()).toBe(200)

    await searchBoms(page, fixture.outputName)

    const draftRow = page.getByRole('row', { name: new RegExp(fixture.outputName) })

    await expect(draftRow).toHaveCount(1)
    await expect(draftRow.getByText(fixture.outputSku)).toBeVisible()
    await expect(draftRow.getByText(draftStatus)).toBeVisible()
    await expect(draftRow.getByText(unavailableLabel)).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(fixture.alternateName) })).toHaveCount(0)

    await searchBoms(page, fixture.alternateName)

    const releasedRow = page.getByRole('row', { name: new RegExp(fixture.alternateName) })

    await expect(releasedRow).toHaveCount(1)
    await expect(releasedRow.getByText(releasedStatus)).toBeVisible()
    await expect(releasedRow.getByText(availableLabel)).toBeVisible()

    await releasedRow.click()
    await expect(page).toHaveURL(
      new RegExp(`/backend/manufacturing/boms/${releasedBomId}$`),
    )
  })
})

test('filters incomplete revisions', async ({
  request,
  page,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const incompleteBomId = await fixture.createBom()

    expect((await fixture.release(incompleteBomId)).status()).toBe(200)

    const completeBomId = await fixture.createBom(fixture.alternateVariantId)

    await fixture.createItem(completeBomId, fixture.componentVariantId)
    expect((await fixture.release(completeBomId)).status()).toBe(200)

    await login(page, 'admin')

    const initialList = waitForBomList(page)

    await page.goto('/backend/manufacturing/boms')
    expect((await initialList).status()).toBe(200)

    // Output and alternate variant names share the fixture tag, so one term finds both BOMs.
    const tag = fixture.outputSku.slice('MFG-O-'.length)

    await searchBoms(page, tag)

    await expect(page.getByRole('row', { name: new RegExp(tag) })).toHaveCount(2)

    await page.getByRole('button', { name: /^(Filtry|Filters)/i }).click()

    const filterPanel = page.locator('.fixed.inset-0')

    await expect(filterPanel).toBeVisible()
    await filterPanel.getByRole('combobox').first().click()
    await page.getByRole('option', { name: incompleteStatus }).click()

    const filteredList = page.waitForResponse((response) => {
      const url = new URL(response.url())

      return url.pathname === '/api/manufacturing/boms'
        && url.searchParams.get('isIncomplete') === 'true'
    })

    await filterPanel.getByRole('button', { name: /Zastosuj|Apply/i }).first().click()
    expect((await filteredList).status()).toBe(200)

    const rows = page.getByRole('row', { name: new RegExp(tag) })

    await expect(rows).toHaveCount(1)
    await expect(rows.getByText(fixture.outputName)).toBeVisible()
    await expect(rows.getByText(incompleteStatus)).toBeVisible()
  })
})
