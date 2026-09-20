import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'supplier_demo.supply_case.reply_received',
  persistent: true,
  id: 'supplier-demo:apply-acceptance',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.caseId !== 'string' || typeof payload.supplyMessageId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_case.apply_acceptance', {
    caseId: payload.caseId,
    supplyMessageId: payload.supplyMessageId,
  }, payload)
}
