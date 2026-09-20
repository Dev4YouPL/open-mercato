import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'supplier_demo.supply_case.commitment_updated',
  persistent: true,
  id: 'supplier-demo:send-confirmation-email',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.confirmationMessageId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_message.send', { supplyMessageId: payload.confirmationMessageId }, payload)
}
