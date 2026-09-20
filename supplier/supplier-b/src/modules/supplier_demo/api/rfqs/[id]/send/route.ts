import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createMutationContext, commandErrorResponse, responseFromCommand } from '../../../supply-cases/route-utils'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['supplier_demo.rfqs.manage'] } }

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const prepared = await createMutationContext(req, 'supplier_demo:supplier_rfq', 'custom', { id }, id)
  if ('response' in prepared) return prepared.response
  try {
    const result = await prepared.container.resolve<{ execute: (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => Promise<{ result: unknown }> }>('commandBus').execute('supplier_demo.rfq.send_approved', { input: { rfqId: id }, ctx: prepared.ctx })
    await prepared.guardResult.runAfterSuccess()
    return responseFromCommand(result, 202)
  } catch (error) { return commandErrorResponse(error) }
}
