import { recordSupplyRejectionDeliveryActivity, resolveSupplyRejectionCorrelation } from '../lib/outbound/rejectionDeliveryActivity'

export const metadata = {
  event: 'communication_channels.message.delivery_exhausted',
  persistent: true,
  id: 'supply_cases:supply-rejection-delivery-exhausted',
}

type Payload = { messageId?: unknown; tenantId?: unknown; organizationId?: unknown }
type Resolver = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: Payload, ctx: Resolver & { container?: Resolver }) {
  const container = ctx.container ?? ctx
  const resolved = await resolveSupplyRejectionCorrelation(payload, container)
  if (!resolved) return
  await recordSupplyRejectionDeliveryActivity(resolved, 'error', metadata.id)
}
