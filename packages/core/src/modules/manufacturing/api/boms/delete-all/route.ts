import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { bomDeleteAllSchema } from '../../../data/validators'
import type { BomDeleteAllInput } from '../../../data/validators'
import { listActiveBomRevisionIds } from '../../../lib/bomDeletionQueries'
import { resolveBomActionContext } from '../../../lib/bomActionRoute'
import type { EntityManager } from '@mikro-orm/postgresql'

const resultSchema = z.object({ outputVariantId: z.string().uuid(), deletedBomIds: z.array(z.string().uuid()) })
const errorSchema = z.object({ error: z.string(), code: z.string().optional() }).passthrough()
export const metadata = { POST: { requireAuth: true, requireFeatures: ['manufacturing.manage'] } }

export async function POST(req: Request): Promise<Response> {
  try {
    const { translate } = await resolveTranslations()
    const { container, ctx, scope, userId } = await resolveBomActionContext(req, translate)
    const parsed = bomDeleteAllSchema.safeParse(await readJsonSafe<unknown>(req))
    if (!parsed.success) return NextResponse.json({ error: translate('manufacturing.errors.invalidDeletePayload') }, { status: 400 })
    const em = container.resolve<EntityManager>('em').fork()
    const revisionIds = await listActiveBomRevisionIds(em, scope, parsed.data.outputVariantId)
    if (!revisionIds.length) return NextResponse.json({ error: translate('manufacturing.errors.bomUnavailable') }, { status: 404 })
    const guards = []
    for (const revisionId of revisionIds) {
      const guard = await runRouteMutationGuards({ container, req, auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId }, input: { resourceKind: 'manufacturing.bom', resourceId: revisionId, operation: 'delete', mutationPayload: { id: revisionId, ...parsed.data } } })
      if (!guard.ok) return guard.response
      if (guard.modifiedPayload) return NextResponse.json({ error: translate('manufacturing.errors.invalidDeletePayload') }, { status: 400 })
      guards.push(guard)
    }
    const commandBus = container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<BomDeleteAllInput, z.infer<typeof resultSchema>>('manufacturing.boms.delete_all', { input: parsed.data, ctx })
    const deleted = resultSchema.parse(result)
    for (const guard of guards) {
      try {
        await guard.runAfterSuccess()
      } catch (error) {
        getTelemetryRuntime()?.reportError(error, { module: 'manufacturing', code: 'manufacturing.bom_delete_all_guard_callback_failed' })
      }
    }
    return NextResponse.json(deleted)
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'manufacturing', code: 'manufacturing.bom_delete_all_request_failed' })
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('manufacturing.boms.delete.failed') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing', summary: 'Delete a BOM family',
  methods: { POST: { summary: 'Soft delete all unused BOM revisions and items', requestBody: { contentType: 'application/json', schema: bomDeleteAllSchema }, responses: [{ status: 200, description: 'BOM family deleted', schema: resultSchema }, { status: 400, description: 'Invalid payload', schema: errorSchema }, { status: 404, description: 'BOM unavailable', schema: errorSchema }, { status: 409, description: 'BOM family is in use or stale', schema: errorSchema }, { status: 423, description: 'Record locked', schema: errorSchema }, { status: 500, description: 'Unexpected deletion failure', schema: errorSchema }] } },
}
