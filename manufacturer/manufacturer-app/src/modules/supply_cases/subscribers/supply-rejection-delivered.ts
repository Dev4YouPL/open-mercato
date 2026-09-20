import { recordSupplyRejectionDeliveryActivity, resolveSupplyRejectionCorrelation } from '../lib/outbound/rejectionDeliveryActivity'

export const metadata = {
  event: 'communication_channels.message.sent',
  persistent: true,
  id: 'supply_cases:supply-rejection-delivered',
}

type Payload = { channelLinkId?: unknown; tenantId?: unknown; organizationId?: unknown }
type Resolver = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: Payload, ctx: Resolver & { container?: Resolver }) {
  const container = ctx.container ?? ctx
  const resolved = await resolveSupplyRejectionCorrelation(payload, container)
  if (!resolved) return
  await recordSupplyRejectionDeliveryActivity(resolved, 'success', metadata.id)
}
