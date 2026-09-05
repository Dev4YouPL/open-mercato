import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
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
      await expect(page.getByText(code)).toBeVisible({ timeout: 20000 })
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

      await page.getByLabel(/^code$/i).fill(code)
      await page.getByLabel(/^name$/i).fill('Created in browser')
      await page.getByRole('button', { name: /create work centre|utwórz/i }).click()

      await expect(page).toHaveURL(new RegExp(`${LIST_URL}(/|$)`), { timeout: 20000 })

      // Confirm through the API that the browser write really landed.
      const { body } = await (
        await import('./helpers')
      ).listWorkCenters(request, token, `?search=${encodeURIComponent(code)}`)
      expect(body.items?.[0]?.name).toBe('Created in browser')
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

      await expect(page.getByLabel(/^code$/i)).toHaveValue(code, { timeout: 20000 })
      await expect(page.getByLabel(/^name$/i)).toHaveValue('Detail cell')
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
