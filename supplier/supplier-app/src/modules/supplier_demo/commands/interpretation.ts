import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitSupplierDemoEvent } from '../events'
import { isFreeformUnderstandingEnabled } from '../lib/toggles'
import { runSupplierReplyInterpretation } from '../lib/interpretation/runner'

type Scope = { tenantId: string; organizationId: string }

function scopeFrom(ctx: CommandRuntimeContext): Scope | null {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  return tenantId && organizationId ? { tenantId, organizationId } : null
}

const eventOptions = { persistent: true, ...({ deliverInline: false } as Record<string, unknown>) }

export const interpretReply: CommandHandler<Record<string, unknown>, { status: string; reason: string; runId?: string; counterId?: string }> = {
  id: 'supplier_demo.supply_message.interpret_reply',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    if (!scope) return { status: 'needs_human', reason: 'missing_scope' }
    const caseId = typeof rawInput.caseId === 'string' ? rawInput.caseId : null
    const supplyMessageId = typeof rawInput.supplyMessageId === 'string' ? rawInput.supplyMessageId : null
    const attemptNo = typeof rawInput.attemptNo === 'number' && Number.isInteger(rawInput.attemptNo) ? rawInput.attemptNo : 1
    if (!caseId || !supplyMessageId) return { status: 'needs_human', reason: 'invalid_input' }
    if (!(await isFreeformUnderstandingEnabled(ctx.container, scope.tenantId))) return { status: 'display_only', reason: 'freeform_understanding_disabled' }
    const result = await runSupplierReplyInterpretation({
      em: (ctx.transactionalEm ?? ctx.container.resolve('em')) as EntityManager,
      scope,
      caseId,
      supplyMessageId,
      attemptNo,
      container: ctx.container,
    })
    if (result.status === 'counter_received' && result.counterId) {
      await emitSupplierDemoEvent('supplier_demo.supply_case.counter_received', {
        ...scope,
        caseId,
        supplyMessageId: result.counterId,
        reason: result.reason,
      }, eventOptions)
    } else {
      await emitSupplierDemoEvent('supplier_demo.supply_case.attention_required', {
        ...scope,
        caseId,
        supplyMessageId,
        reason: result.reason,
        status: result.status === 'display_only' ? 'needs_human' : result.status,
      }, eventOptions)
    }
    return result
  },
}

registerCommand(interpretReply)
