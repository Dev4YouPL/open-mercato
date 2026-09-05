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
