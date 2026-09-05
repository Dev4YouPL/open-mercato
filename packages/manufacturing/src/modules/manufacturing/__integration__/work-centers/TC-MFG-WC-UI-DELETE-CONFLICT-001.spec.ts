import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  adminToken,
  filterList,
  cleanupWorkCenter,
  createWorkCenter,
  openRowActions,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

const LIST_URL = '/backend/manufacturing/work-centers'

/**
 * TC-MFG-WC-UI-DELETE-CONFLICT-001: the list row delete is a guarded mutation
 * rather than a CrudForm submit, so it carries the row's own version. A stale
 * row must surface the same 409 bar and survive.
 */
test.describe('TC-MFG-WC-UI-DELETE-CONFLICT-001: stale list row delete', () => {
  test('refuses a stale row delete and keeps the row', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-DELCONF')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Delete target' })).id

      await login(page, 'admin')
      await page.goto(LIST_URL)
      await filterList(page, code)

      // The list now holds a stale version for this row.
      const current = await readWorkCenter(request, token, id as string)
      expect((await updateWorkCenter(request, token, { id, name: 'Bumped elsewhere' }, current?.updatedAt)).status).toBe(
        200,
      )

      await openRowActions(page)
      await page.getByRole('menuitem').filter({ hasText: /delete|usuń/i }).first().click()
      await page
        .getByRole('alertdialog')
        .getByRole('button')
        .filter({ hasText: /delete|usuń/i })
        .first()
        .click()

      await expect(page.getByText(/changed since|record changed|zmieni/i).first()).toBeVisible({ timeout: 20000 })

      // The record survives the refused delete.
      const survivor = await readWorkCenter(request, token, id as string)
      expect(survivor, 'a refused delete must not soft-delete the record').toBeTruthy()
      expect(survivor?.name).toBe('Bumped elsewhere')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('deletes cleanly when the row version is current', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-DELOK')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Clean delete' })).id

      await login(page, 'admin')
      await page.goto(LIST_URL)
      await filterList(page, code)

      await openRowActions(page)
      await page.getByRole('menuitem').filter({ hasText: /delete|usuń/i }).first().click()
      await page
        .getByRole('alertdialog')
        .getByRole('button')
        .filter({ hasText: /delete|usuń/i })
        .first()
        .click()

      await expect
        .poll(async () => await readWorkCenter(request, token, id as string), { timeout: 20000 })
        .toBeNull()
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })
})
