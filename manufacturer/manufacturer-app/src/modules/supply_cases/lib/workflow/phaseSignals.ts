import type { EntityManager } from '@mikro-orm/postgresql'
import type { StoreScope } from '../../data/repositories'

type Resolver = { resolve: <T = unknown>(name: string) => T }

type SignalHandler = {
  sendSignal(
    em: EntityManager,
    container: unknown,
    options: {
      instanceId: string
      signalName: string
      payload: Record<string, unknown>
      tenantId: string
      organizationId: string
    },
  ): Promise<void>
}

export async function signalCaseWorkflow(
  container: Resolver,
  scope: StoreScope,
  workflowInstanceId: string | null,
  signalName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!workflowInstanceId) return
  const em = container.resolve<EntityManager>('em').fork()
  const signalHandler = container.resolve<SignalHandler>('signalHandler')
  await signalHandler.sendSignal(em, container, {
    instanceId: workflowInstanceId,
    signalName,
    payload,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}
