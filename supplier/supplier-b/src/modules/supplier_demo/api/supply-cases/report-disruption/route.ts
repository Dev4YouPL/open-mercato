import { reportDisruptionBodySchema, reportDisruptionOpenApi, reportDisruptionResponseSchema } from '../../supplier-cases-openapi'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createMutationContext, commandErrorResponse, readBody, responseFromCommand } from '../route-utils'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['supplier_demo.supply_cases.manage'] },
}

export async function POST(req: Request) {
  const parsed = reportDisruptionBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const prepared = await createMutationContext(req, 'supplier_demo:supply_case', 'create', parsed.data)
  if ('response' in prepared) return prepared.response
  const guarded = reportDisruptionBodySchema.safeParse({ ...parsed.data, ...(prepared.guardResult.modifiedPayload ?? {}) })
  if (!guarded.success) return Response.json({ error: 'Invalid payload' }, { status: 422 })
  try {
    const result = await prepared.container.resolve<{ execute: (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => Promise<{ result: unknown }> }>('commandBus').execute(
      'supplier_demo.supply_case.report_disruption',
      { input: guarded.data, ctx: prepared.ctx },
    )
    await prepared.guardResult.runAfterSuccess()
    return responseFromCommand(result, 201)
  } catch (error) {
    return commandErrorResponse(error)
  }
}

export const openApi = reportDisruptionOpenApi
export { reportDisruptionResponseSchema }
