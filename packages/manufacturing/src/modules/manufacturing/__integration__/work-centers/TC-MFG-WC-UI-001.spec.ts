import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  CODE_FIELD,
  NAME_FIELD,
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
  formField,
  listWorkCenters,
  uniqueCode,
} from './helpers'

const LIST_URL = '/backend/manufacturing/work-centers'

/**
 * TC-MFG-WC-UI-001: all three Work Centre pages render and hydrate in a real
 * browser, with no client-side route error and no scheduler/WMS affordance.
 */
test.describe('TC-MFG-WC-UI-001: Work Centre pages', () => {
  test('renders the list with its columns and create affordance', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-UI1')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Visible cell' })).id

      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))

      await login(page, 'admin')
      await page.goto(LIST_URL)
      await expect(page.getByText(code).first()).toBeVisible({ timeout: 20000 })
      await expect(page.getByText('Visible cell')).toBeVisible()
      await expect(page.getByRole('link', { name: /new work centre|nowe gniazdo/i })).toBeVisible()

      // Nothing on this page may suggest scheduling or reservation.
      await expect(page.getByText(/schedule|reserve|capacity/i)).toHaveCount(0)
      expect(errors, `client errors: ${errors.join('; ')}`).toEqual([])
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('opens the create page and saves a new Work Centre', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-UI2')
    let id: string | null = null

    try {
      await login(page, 'admin')
      await page.goto(`${LIST_URL}/create`)

      await formField(page, CODE_FIELD).fill(code)
      await formField(page, NAME_FIELD).fill('Created in browser')
      await page.getByRole('button', { name: /create work centre|utwórz/i }).first().click()

      // The form navigates away from /create once the write lands; poll the API
      // rather than assuming the redirect and the commit are simultaneous.
      await expect(page).not.toHaveURL(/\/create$/, { timeout: 20000 })

      await expect
        .poll(
          async () => {
            const { body } = await listWorkCenters(request, token, `?search=${encodeURIComponent(code)}`)
            return body.items?.[0]?.name ?? null
          },
          { timeout: 20000 },
        )
        .toBe('Created in browser')

      const { body } = await listWorkCenters(request, token, `?search=${encodeURIComponent(code)}`)
      id = body.items?.[0]?.id ?? null
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('opens the detail page and hydrates the stored values', async ({ page, request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-UI3')
    let id: string | null = null

    try {
      id = (
        await createWorkCenter(request, token, { code, name: 'Detail cell', description: 'Detail notes' })
      ).id

      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/${id}`)

      await expect(formField(page, CODE_FIELD)).toHaveValue(code, { timeout: 20000 })
      await expect(formField(page, NAME_FIELD)).toHaveValue('Detail cell')
      expect(errors, `client errors: ${errors.join('; ')}`).toEqual([])
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('shows the not-found state for a missing record instead of an empty form', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`${LIST_URL}/11111111-1111-4111-8111-111111111111`)
    await expect(page.getByText(/not found|nie znaleziono/i)).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('link', { name: /back to work centres|powrót/i })).toBeVisible()
  })
})
