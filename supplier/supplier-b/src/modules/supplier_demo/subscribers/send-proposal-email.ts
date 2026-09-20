import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'supplier_demo.supply_case.proposal_ready',
  persistent: true,
  id: 'supplier-demo:send-proposal-email',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.supplyMessageId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_message.send', { supplyMessageId: payload.supplyMessageId }, payload)
}
