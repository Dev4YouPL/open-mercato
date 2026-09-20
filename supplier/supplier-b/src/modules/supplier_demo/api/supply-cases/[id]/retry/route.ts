import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { retryBodySchema, retryOpenApi } from '../../../supplier-cases-openapi'
import { createMutationContext, commandErrorResponse, readBody, responseFromCommand } from '../../route-utils'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['supplier_demo.supply_cases.manage'] },
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const parsed = retryBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const prepared = await createMutationContext(req, 'supplier_demo:supply_case', 'custom', { id, ...parsed.data }, id)
  if ('response' in prepared) return prepared.response
  const guarded = retryBodySchema.safeParse({ ...parsed.data, ...(prepared.guardResult.modifiedPayload ?? {}) })
  if (!guarded.success) return Response.json({ error: 'Invalid payload' }, { status: 422 })
  try {
    const result = await prepared.container.resolve<{ execute: (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => Promise<{ result: unknown }> }>('commandBus').execute(
      'supplier_demo.supply_case.retry',
      { input: { caseId: id, updatedAt: new Date(guarded.data.updatedAt) }, ctx: prepared.ctx },
    )
    await prepared.guardResult.runAfterSuccess()
    return responseFromCommand(result, 202)
  } catch (error) {
    return commandErrorResponse(error)
  }
}

export const openApi = retryOpenApi
