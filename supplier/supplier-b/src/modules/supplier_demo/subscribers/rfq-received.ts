import { executeSupplierCommand } from './helpers'

export const metadata = {
  event: 'supplier_demo.rfq.received',
  persistent: true,
  id: 'supplier-demo:rfq-interpreter',
}

export default async function handle(payload: Record<string, unknown>, ctx: { resolve: <T = unknown>(name: string) => T }) {
  if (typeof payload.rfqId !== 'string') return
  await executeSupplierCommand(ctx, 'supplier_demo.rfq.interpret', payload, payload)
}
