import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createMutationContext, commandErrorResponse, readBody, responseFromCommand } from '../../../supply-cases/route-utils'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['supplier_demo.rfqs.manage'] } }
const bodySchema = z.object({ updatedAt: z.string().datetime() })

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const parsed = bodySchema.safeParse(await readBody(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const prepared = await createMutationContext(req, 'supplier_demo:supplier_rfq', 'custom', { id, ...parsed.data }, id)
  if ('response' in prepared) return prepared.response
  try {
    const result = await prepared.container.resolve<{ execute: (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => Promise<{ result: unknown }> }>('commandBus').execute('supplier_demo.rfq.approve', { input: { rfqId: id, updatedAt: new Date(parsed.data.updatedAt) }, ctx: prepared.ctx })
    await prepared.guardResult.runAfterSuccess()
    return responseFromCommand(result, 202)
  } catch (error) { return commandErrorResponse(error) }
}
