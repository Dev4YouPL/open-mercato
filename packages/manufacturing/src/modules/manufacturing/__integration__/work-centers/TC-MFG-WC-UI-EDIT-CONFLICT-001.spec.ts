import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  NAME_FIELD,
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
  formField,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

const LIST_URL = '/backend/manufacturing/work-centers'

/**
 * TC-MFG-WC-UI-EDIT-CONFLICT-001: a stale edit form surfaces the unified 409
 * bar, keeps what the user typed, and leaves the server record untouched until
 * they deliberately recover.
 */
test.describe('TC-MFG-WC-UI-EDIT-CONFLICT-001: stale edit form', () => {
  test('shows the conflict bar and preserves entered values', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-EDITCONF')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Original name' })).id

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/${id}`)
      await expect(formField(page, NAME_FIELD)).toHaveValue('Original name', { timeout: 20000 })

      // A second actor commits while this form holds the old version.
      const current = await readWorkCenter(request, token, id as string)
      const elsewhere = await updateWorkCenter(
        request,
        token,
        { id, name: 'Changed elsewhere' },
        current?.updatedAt,
      )
      expect(elsewhere.status).toBe(200)

      await formField(page, NAME_FIELD).fill('My local edit')
      await page.getByRole('button', { name: /^(save|zapisz)$/i }).first().click()

      // The unified conflict surface, not a bare error toast.
      await expect(page.getByText(/changed since|record changed|zmieni/i).first()).toBeVisible({ timeout: 20000 })

      // What the user typed is still on screen...
      await expect(formField(page, NAME_FIELD)).toHaveValue('My local edit')

      // ...and the refused save wrote nothing.
      const afterConflict = await readWorkCenter(request, token, id as string)
      expect(afterConflict?.name).toBe('Changed elsewhere')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('allows two consecutive saves without a self-inflicted conflict', async ({ page, request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    /** Submits the form and resolves once the PUT has actually completed. */
    const save = async () => {
      const response = page.waitForResponse(
        (candidate) =>
          candidate.url().includes('/api/manufacturing/work-centers') && candidate.request().method() === 'PUT',
        { timeout: 20000 },
      )
      await page.getByRole('button', { name: /^(save|zapisz)$/i }).first().click()
      return response
    }

    try {
      id = (await createWorkCenter(request, token, { code: uniqueCode('WC-TWOSAVE'), name: 'First' })).id

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/${id}`)
      await expect(formField(page, NAME_FIELD)).toHaveValue('First', { timeout: 20000 })

      await formField(page, NAME_FIELD).fill('Second')
      expect((await save()).status()).toBe(200)

      // The save triggers a re-read that replaces the form values; wait for it
      // to land before typing again, or the next keystrokes are discarded.
      await expect(formField(page, NAME_FIELD)).toHaveValue('Second', { timeout: 20000 })

      // The form must now hold the version its own save produced. Without the
      // re-read this second submit resubmits the stale token and 409s against
      // the user's own first save.
      await formField(page, NAME_FIELD).fill('Third')
      await expect(formField(page, NAME_FIELD)).toHaveValue('Third')
      expect((await save()).status(), 'a second save must not conflict with the first').toBe(200)

      await expect(page.getByText(/changed since|record changed|zmieni/i)).toHaveCount(0)
      await expect
        .poll(async () => (await readWorkCenter(request, token, id as string))?.name, { timeout: 20000 })
        .toBe('Third')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('lets a deliberate retry against the refreshed version succeed', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-EDITCONF2')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Base' })).id

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/${id}`)
      await expect(formField(page, NAME_FIELD)).toHaveValue('Base', { timeout: 20000 })

      const current = await readWorkCenter(request, token, id as string)
      await updateWorkCenter(request, token, { id, name: 'Bumped' }, current?.updatedAt)

      await formField(page, NAME_FIELD).fill('Deliberate retry')
      await page.getByRole('button', { name: /^(save|zapisz)$/i }).first().click()
      await expect(page.getByText(/changed since|record changed|zmieni/i).first()).toBeVisible({ timeout: 20000 })

      // Reload adopts the current server version, then the same edit lands.
      await page.reload()
      await expect(formField(page, NAME_FIELD)).toHaveValue('Bumped', { timeout: 20000 })
      await formField(page, NAME_FIELD).fill('Deliberate retry')
      await page.getByRole('button', { name: /^(save|zapisz)$/i }).first().click()

      await expect
        .poll(async () => (await readWorkCenter(request, token, id as string))?.name, { timeout: 20000 })
        .toBe('Deliberate retry')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })
})
