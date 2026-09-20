import type { EntityManager } from '@mikro-orm/postgresql'
import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'supplier_demo.supply_case.reply_interpretation_requested',
  persistent: true,
  id: 'supplier-demo:interpret-reply',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.caseId !== 'string' || typeof payload.supplyMessageId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.supply_message.interpret_reply', {
    caseId: payload.caseId,
    supplyMessageId: payload.supplyMessageId,
    attemptNo: typeof payload.attemptNo === 'number' ? payload.attemptNo : 1,
  }, payload)
}
