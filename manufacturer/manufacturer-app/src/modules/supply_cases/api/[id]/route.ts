import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getSupplyCasesStore } from '../../di'
import { buildSupplyCaseDetail } from '../../data/read-model'
import { detailOpenApi } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['supply_cases.view'] },
}

export const openApi = detailOpenApi

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) return jsonError('unauthorized', 401)
    if (!auth.orgId) return jsonError('organization_scope_required', 400)
    const id = z.string().min(1).parse(context.params.id)

    const container = await createRequestContainer()
    const rbac = container.resolve<RbacService>('rbacService')
    const includeMessageContent = await rbac.userHasAllFeatures(
      auth.sub,
      ['supply_cases.messages.view'],
      { tenantId: auth.tenantId, organizationId: auth.orgId },
    )
    const result = await buildSupplyCaseDetail(
      getSupplyCasesStore(),
      { tenantId: auth.tenantId, organizationId: auth.orgId },
      id,
      includeMessageContent,
    )
    if (!result) return jsonError('not_found', 404)
    return Response.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError('invalid_id', 400)
    return jsonError('internal_error', 500)
  }
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status })
}
