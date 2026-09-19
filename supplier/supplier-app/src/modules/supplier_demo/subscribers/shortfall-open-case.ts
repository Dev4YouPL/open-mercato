import { isAutoSupplyProposalEnabled } from '../lib/toggles'
import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'wms.inventory.reservation_shortfall',
  persistent: true,
  id: 'supplier-demo:shortfall-open-case',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  if (!tenantId || !(await isAutoSupplyProposalEnabled(ctx, tenantId))) return
  if (typeof payload.orderId !== 'string' || typeof payload.orderNumber !== 'string' || !Array.isArray(payload.shortfalls)) return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_case.open_from_shortfall', {
    salesOrderId: payload.orderId,
    orderNumber: payload.orderNumber,
    shortfalls: payload.shortfalls,
    trigger: 'wms_shortfall',
  }, payload)
}
