import { recordSupplyRejectionDeliveryActivity, resolveSupplyRejectionCorrelation } from '../lib/outbound/rejectionDeliveryActivity'

export const metadata = {
  event: 'communication_channels.message.delivery_failed',
  persistent: true,
  id: 'supply_cases:supply-rejection-delivery-failed',
}

type Payload = { channelLinkId?: unknown; tenantId?: unknown; organizationId?: unknown; transient?: unknown }
type Resolver = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: Payload, ctx: Resolver & { container?: Resolver }) {
  if (payload.transient !== false) return
  const container = ctx.container ?? ctx
  const resolved = await resolveSupplyRejectionCorrelation(payload, container)
  if (!resolved) return
  await recordSupplyRejectionDeliveryActivity(resolved, 'error', metadata.id)
}
