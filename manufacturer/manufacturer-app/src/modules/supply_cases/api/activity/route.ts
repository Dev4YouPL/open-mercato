import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getSupplyCasesStore } from '../../di'
import { activityOpenApi } from '../openapi'
import { parseActivityQuery, readActivityPage } from '../../lib/activity/readActivity'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['supply_cases.view'] },
}

export const openApi = activityOpenApi

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) return jsonError('unauthorized', 401)
    if (!auth.orgId) return jsonError('organization_scope_required', 400)
    const query = parseActivityQuery(new URL(request.url).searchParams)
    const container = await createRequestContainer()
    const rbac = container.resolve<RbacService>('rbacService')
    const [canViewMessages, canViewTrace] = await Promise.all([
      rbac.userHasAllFeatures(auth.sub, ['supply_cases.messages.view'], { tenantId: auth.tenantId, organizationId: auth.orgId }),
      rbac.userHasAllFeatures(auth.sub, ['agent_orchestrator.trace.view'], { tenantId: auth.tenantId, organizationId: auth.orgId }),
    ])
    const result = await readActivityPage(
      getSupplyCasesStore(),
      { tenantId: auth.tenantId, organizationId: auth.orgId },
      { ...query, canViewMessages, canViewTrace },
    )
    if (!result) return jsonError('not_found', 404)
    return Response.json(result)
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof Error && ['[internal] invalid_limit', '[internal] invalid_caseId', '[internal] invalid_cursor'].includes(error.message)) return jsonError('invalid_query', 400)
    return jsonError('internal_error', 500)
  }
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status })
}
