import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'communication_channels.message.sent',
  persistent: true,
  id: 'supplier-demo:track-proposal-sent',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (payload.direction !== 'outbound' || typeof payload.messageId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_message.track_delivery', payload, payload)
}
