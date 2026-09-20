import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'supplier-demo:inbound-supply-reply',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.channelLinkId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_message.receive_inbound', payload, payload)
}
