import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getSupplyCasesStore } from '../di'
import {
  buildSupplyCaseList,
  parseSupplyCaseListQuery,
} from '../data/read-model'
import { listOpenApi } from './openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['supply_cases.view'] },
}

export const openApi = listOpenApi

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) return jsonError('unauthorized', 401)
    if (!auth.orgId) return jsonError('organization_scope_required', 400)

    const query = parseSupplyCaseListQuery(new URL(request.url).searchParams)
    const result = await buildSupplyCaseList(getSupplyCasesStore(), {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    }, query)
    return Response.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError('invalid_query', 400)
    return jsonError('internal_error', 500)
  }
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status })
}
