import type { SupplyCasesStore } from '../data/repositories'
import { INBOUND_CASE_WORKFLOW_ID } from '../workflows'

export const metadata = {
  event: 'workflows.instance.failed',
  persistent: true,
  id: 'supply_cases:alternative-offer-wait-timeout',
}

type Payload = {
  id?: unknown
  workflowId?: unknown
  stepId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}
type Resolver = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: Payload, ctx: Resolver & { container?: Resolver }) {
  const instanceId = nonEmpty(payload.id)
  const tenantId = nonEmpty(payload.tenantId)
  const organizationId = nonEmpty(payload.organizationId)
  if (
    !instanceId || !tenantId || !organizationId
    || payload.workflowId !== INBOUND_CASE_WORKFLOW_ID
    || payload.stepId !== 'await-reply'
  ) return
  const store = (ctx.container ?? ctx).resolve<SupplyCasesStore>('supplyCasesStore')
  const scope = { tenantId, organizationId }
  const cases = await store.supplyCases.list(scope, { where: { workflowInstanceId: instanceId } })
  const supplyCase = cases[0]
  if (!supplyCase || supplyCase.status !== 'WAITING_FOR_ALTERNATIVE_OFFER') return
  await store.supplyCases.update(scope, supplyCase.id, { status: 'NEEDS_ATTENTION', needsAttentionReason: 'WAIT_TIMEOUT' })
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
