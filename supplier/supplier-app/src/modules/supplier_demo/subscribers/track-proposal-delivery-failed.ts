import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'communication_channels.message.delivery_failed',
  persistent: true,
  id: 'supplier-demo:track-proposal-delivery-failed',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.messageId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_message.track_delivery', payload, payload)
}
