import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type SupplierEventContext = {
  resolve: <T = unknown>(name: string) => T
}

export type SupplierScopePayload = {
  tenantId?: unknown
  organizationId?: unknown
}

export function trustedSupplierCommandContext(
  ctx: SupplierEventContext,
  payload: SupplierScopePayload,
): CommandRuntimeContext | null {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (!tenantId || !organizationId) return null
  return {
    container: ctx as CommandRuntimeContext['container'],
    auth: { tenantId, orgId: organizationId } as CommandRuntimeContext['auth'],
    organizationScope: {
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    systemActor: true,
  }
}

export async function executeSupplierCommand(
  ctx: SupplierEventContext,
  commandId: string,
  input: Record<string, unknown>,
  payload: SupplierScopePayload,
): Promise<unknown> {
  const commandContext = trustedSupplierCommandContext(ctx, payload)
  if (!commandContext) return null
  const commandBus = ctx.resolve<{ execute: (id: string, input: { input: Record<string, unknown>; ctx: CommandRuntimeContext }) => Promise<unknown> }>('commandBus')
  const execution = await commandBus.execute(commandId, { input, ctx: commandContext })
  return execution
}
