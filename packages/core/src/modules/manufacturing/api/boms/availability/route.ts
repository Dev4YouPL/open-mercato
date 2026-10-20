import { NextResponse } from 'next/server'
import { z } from 'zod'

import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

import { bomAvailabilityUpdateSchema } from '../../../data/validators'
import type { BomAvailabilityUpdateInput } from '../../../data/validators'
import { resolveBomActionContext } from '../../../lib/bomActionRoute'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const commandResultSchema = z.object({
  bomId: uuidSchema,
  isAvailableForNewOrders: z.boolean(),
  updatedAt: timestampSchema,
})
const responseSchema = z.object({
  id: uuidSchema,
  isAvailableForNewOrders: z.boolean(),
  updatedAt: timestampSchema,
})
const errorSchema = z.object({ error: z.string(), code: z.string().optional() }).passthrough()

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['manufacturing.manage'] },
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { translate } = await resolveTranslations()
    const { container, ctx, scope, userId } = await resolveBomActionContext(req, translate)
    const parsed = bomAvailabilityUpdateSchema.safeParse(await readJsonSafe<unknown>(req))
    if (!parsed.success) {
      return NextResponse.json({ error: translate('manufacturing.errors.invalidAvailabilityPayload') }, { status: 400 })
    }
    const guard = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      input: {
        resourceKind: 'manufacturing.bom',
        resourceId: parsed.data.id,
        operation: 'custom',
        mutationPayload: parsed.data,
      },
    })
    if (!guard.ok) return guard.response
    const guardedInput = bomAvailabilityUpdateSchema.safeParse(guard.modifiedPayload ?? parsed.data)
    if (!guardedInput.success || guardedInput.data.id.toLowerCase() !== parsed.data.id.toLowerCase()) {
      return NextResponse.json({ error: translate('manufacturing.errors.invalidAvailabilityPayload') }, { status: 400 })
    }
    const commandBus = container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<BomAvailabilityUpdateInput, z.infer<typeof commandResultSchema>>(
      'manufacturing.boms.set_availability',
      { input: guardedInput.data, ctx },
    )
    const changed = commandResultSchema.parse(result)
    await guard.runAfterSuccess()
    return NextResponse.json(responseSchema.parse({
      id: changed.bomId,
      isAvailableForNewOrders: changed.isAvailableForNewOrders,
      updatedAt: changed.updatedAt,
    }), { status: 200 })
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'manufacturing',
      code: 'manufacturing.bom_availability_request_failed',
    })
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('manufacturing.errors.bomAvailabilityFailed') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Change availability of a released BOM revision',
  methods: {
    POST: {
      summary: 'Set BOM availability for new production orders',
      requestBody: { contentType: 'application/json', schema: bomAvailabilityUpdateSchema },
      responses: [
        { status: 200, description: 'Availability updated', schema: responseSchema },
        { status: 400, description: 'Invalid payload or missing organization context', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 404, description: 'BOM unavailable in the current scope', schema: errorSchema },
        { status: 409, description: 'Revision is not released or version conflict', schema: errorSchema },
        { status: 422, description: 'Rejected by a mutation guard', schema: errorSchema },
        { status: 423, description: 'Record locked', schema: errorSchema },
        { status: 500, description: 'Unexpected availability failure', schema: errorSchema },
      ],
    },
  },
}
