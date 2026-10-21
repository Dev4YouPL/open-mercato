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

const releaseButtonName = /^(Wydaj rewizję|Release revision)$/
const cancelButtonName = /^(Anuluj|Cancel)$/
const releasedStatus = /^(Wydana|Released)$/
const draftStatus = /^(Robocza|Draft)$/
const incompleteStatus = /^(Niekompletna|Incomplete)$/
const blockedTitle =
  /Nie można wydać rewizji|Cannot release this revision/

async function confirmRelease(
  page: Page,
  keyboard = false,
): Promise<void> {
  const dialog = page.getByRole('alertdialog')

  const responsePromise = page.waitForResponse(
    (response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname
        === '/api/manufacturing/boms/release'
    ),
  )

  if (keyboard) {
    await dialog.press('Control+Enter')
  } else {
    await dialog.getByRole('button', {
      name: releaseButtonName,
    }).click()
  }

  const response = await responsePromise
  expect(response.status()).toBe(200)
}

test('supports cancellation and locks a released BOM after reload', async ({
  request,
  page,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()

    await fixture.createItem(
      bomId,
      fixture.componentVariantId,
    )

    await login(page, 'admin')
    await page.goto(`/backend/manufacturing/boms/${bomId}`)

    const releaseButton = page.getByRole('button', {
      name: releaseButtonName,
    })

    await expect(releaseButton).toBeEnabled()
    await releaseButton.click()

    const dialog = page.getByRole('alertdialog')

    await expect(dialog).toContainText(
      /(?:Liczba pozycji objętych wydaniem|Number of items included in this release): 1\./,
    )

    await dialog.getByRole('button', {
      name: cancelButtonName,
    }).click()

    await expect(dialog).not.toBeVisible()
    expect((await fixture.readBom(bomId)).status).toBe('draft')

    await releaseButton.click()
    await dialog.press('Escape')

    await expect(dialog).not.toBeVisible()
    expect((await fixture.readBom(bomId)).status).toBe('draft')

    await releaseButton.click()
    await confirmRelease(page)

    await expect(page.getByText(releasedStatus)).toBeVisible()

    await page.reload()

    await expect(page.getByText(releasedStatus)).toBeVisible()

    await expect(page.getByLabel(
      /Ilość bazowa|Base quantity/i,
    )).toBeDisabled()

    await expect(page.getByRole('button', {
      name: releaseButtonName,
    })).toHaveCount(0)

    await expect(page.getByRole('button', {
      name: /^(Dodaj komponent|Add component)$/,
    })).toHaveCount(0)

    await expect(page.getByText(
      fixture.componentName,
      { exact: false },
    )).toBeVisible()

    expect((await fixture.readBom(bomId)).status).toBe('released')
    expect(await fixture.readItems(bomId)).toHaveLength(1)
  })
})

test('warns before releasing an empty BOM and persists the warning', async ({
  request,
  page,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()

    await login(page, 'admin')
    await page.goto(`/backend/manufacturing/boms/${bomId}`)

    await page.getByRole('button', {
      name: releaseButtonName,
    }).click()

    const dialog = page.getByRole('alertdialog')

    await expect(dialog).toContainText(
      /(?:Liczba pozycji objętych wydaniem|Number of items included in this release): 0\./,
    )

    await expect(dialog).toContainText(
      /Ta rewizja nie zawiera pozycji|This revision has no items/,
    )

    await confirmRelease(page, true)

    await expect(page.getByText(incompleteStatus)).toBeVisible()

    await page.reload()

    await expect(page.getByText(releasedStatus)).toBeVisible()
    await expect(page.getByText(incompleteStatus)).toBeVisible()

    await expect(page.getByRole('alert').filter({
      hasText:
        /Ta rewizja została wydana bez pozycji|This revision was released without items/,
    })).toBeVisible()

    expect(await fixture.readBom(bomId)).toMatchObject({
      status: 'released',
      isIncomplete: true,
    })
  })
})

test('shows WMS requirements and clears the notice on retry and reload', async ({
  request,
  page,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()

    await fixture.createItem(
      bomId,
      fixture.componentVariantId,
    )

    await fixture.createProfile(
      fixture.outputVariantId,
      ['serial'],
    )

    await fixture.createProfile(
      fixture.componentVariantId,
      ['lot', 'expiration'],
    )

    await login(page, 'admin')
    await page.goto(`/backend/manufacturing/boms/${bomId}`)

    const releaseButton = page.getByRole('button', {
      name: releaseButtonName,
    })

    const notice = page.getByRole('alert').filter({
      hasText: blockedTitle,
    })

    async function attemptBlockedRelease() {
      await releaseButton.click()

      const responsePromise = page.waitForResponse(
        (response) => (
          response.request().method() === 'POST'
          && new URL(response.url()).pathname
            === '/api/manufacturing/boms/release'
        ),
      )

      await page.getByRole('alertdialog')
        .getByRole('button', {
          name: releaseButtonName,
        })
        .click()

      expect((await responsePromise).status()).toBe(422)
      await expect(notice).toBeVisible()
    }

    await attemptBlockedRelease()

    await expect(notice).toContainText(fixture.outputName)
    await expect(notice).toContainText(fixture.componentName)
    await expect(notice).toContainText(/wyrób|output product/)
    await expect(notice).toContainText(/komponent|component/)
    await expect(notice).toContainText(/numer seryjny|serial number/)
    await expect(notice).toContainText(/partia|lot/)
    await expect(notice).toContainText(/data ważności|expiration date/)

    await expect(page.getByText(draftStatus)).toBeVisible()

    await expect(page.getByLabel(
      /Ilość bazowa|Base quantity/i,
    )).toBeEnabled()

    await releaseButton.click()

    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(notice).toHaveCount(0)

    await page.getByRole('alertdialog').press('Escape')
    await expect(notice).toHaveCount(0)

    await attemptBlockedRelease()
    await page.reload()

    await expect(page.getByText(draftStatus)).toBeVisible()
    await expect(notice).toHaveCount(0)

    expect((await fixture.readBom(bomId)).status).toBe('draft')
  })
})
