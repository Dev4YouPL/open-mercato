import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

export const WORK_CENTERS_PATH = '/api/manufacturing/work-centers'
export const RESOURCES_PATH = '/api/resources/resources'

export type WorkCenterResponse = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  resourceIds: string[]
  resourceCount: number
  createdAt: string
  updatedAt: string
}

export type ListResponse = {
  items?: WorkCenterResponse[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

/** Unique per run so specs never collide with each other or with seeded data. */
export function uniqueCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase()
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  return getAuthToken(request, 'admin')
}

export async function createWorkCenter(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; id: string | null; body: Record<string, unknown> }> {
  const response = await apiRequest(request, 'POST', WORK_CENTERS_PATH, { token, data: body })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { status: response.status(), id: typeof payload.id === 'string' ? payload.id : null, body: payload }
}

export async function updateWorkCenter(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
  expectedUpdatedAt?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await apiRequest(request, 'PUT', WORK_CENTERS_PATH, {
    token,
    data: body,
    headers: expectedUpdatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': expectedUpdatedAt } : undefined,
  })
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as Record<string, unknown> }
}

export async function deleteWorkCenter(
  request: APIRequestContext,
  token: string,
  id: string,
  expectedUpdatedAt?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await apiRequest(request, 'DELETE', `${WORK_CENTERS_PATH}?id=${encodeURIComponent(id)}`, {
    token,
    headers: expectedUpdatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': expectedUpdatedAt } : undefined,
  })
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as Record<string, unknown> }
}

export async function listWorkCenters(
  request: APIRequestContext,
  token: string,
  query = '',
): Promise<{ status: number; body: ListResponse }> {
  const response = await apiRequest(request, 'GET', `${WORK_CENTERS_PATH}${query}`, { token })
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as ListResponse }
}

export async function readWorkCenter(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<WorkCenterResponse | null> {
  const { body } = await listWorkCenters(request, token, `?ids=${encodeURIComponent(id)}&pageSize=1`)
  return body.items?.[0] ?? null
}

/** Removes a Work Centre regardless of its current version; safe in `finally`. */
export async function cleanupWorkCenter(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await deleteWorkCenter(request, token, id).catch(() => undefined)
}

export type ResourceFixture = { id: string; name: string }

/**
 * Creates a resource through the resources module's own API. Returns null when
 * the module is not enabled or the caller cannot manage resources, so a spec
 * can skip rather than fail in a provider-absent profile.
 */
export async function createResourceFixture(
  request: APIRequestContext,
  token: string,
  name: string,
  isActive = true,
): Promise<ResourceFixture | null> {
  const response = await apiRequest(request, 'POST', RESOURCES_PATH, {
    token,
    data: { name, isActive },
  })
  if (!response.ok()) return null
  const payload = (await response.json().catch(() => ({}))) as { id?: unknown }
  return typeof payload.id === 'string' ? { id: payload.id, name } : null
}

export async function cleanupResource(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${RESOURCES_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(
    () => undefined,
  )
}

export function expectStableError(body: Record<string, unknown>, code: string): void {
  expect(body.code, `expected stable code ${code}, got ${JSON.stringify(body)}`).toBe(code)
  expect(typeof body.error).toBe('string')
}

const BASE_URL = process.env.BASE_URL?.trim() || ''

/** Absolute URL for a raw, token-free request; `apiRequest` always attaches auth. */
export function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

/**
 * Locates a CrudForm input by its visible label.
 *
 * The shared CrudForm renders its `<label>` without an `htmlFor`, so the input
 * has no accessible name and `getByLabel` cannot reach it. Matching the label
 * text and stepping to its sibling input is the structural equivalent, and it
 * tolerates the trailing required marker the form appends.
 */
export function formField(page: import('@playwright/test').Page, label: RegExp) {
  return page
    .locator('label')
    .filter({ hasText: label })
    .locator('xpath=..')
    .locator('input, textarea')
    .first()
}

export const CODE_FIELD = /^Code\s*\*?$/
export const NAME_FIELD = /^Name\s*\*?$/

/** Opens a DataTable row's action menu; the trigger's accessible name is "Open actions". */
export async function openRowActions(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /open actions/i }).first().click()
}

/** Two ISO-8601 spellings of the same instant are equal versions. */
export function sameInstant(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return new Date(left).getTime() === new Date(right).getTime()
}

/**
 * Filters the Work Centre list through its own search box.
 *
 * The list client owns its search state and does not seed it from the URL, so a
 * `?search=` query string would leave the table unfiltered and the target row
 * potentially off the first page.
 */
export async function filterList(page: import('@playwright/test').Page, term: string): Promise<void> {
  const search = page.getByPlaceholder(/search by code or name|szukaj po kodzie/i).first()
  await search.waitFor({ state: 'visible', timeout: 20000 })
  await search.fill(term)
  await page.getByRole('cell', { name: new RegExp(term.slice(0, 18), 'i') }).first().waitFor({ timeout: 20000 })
}
