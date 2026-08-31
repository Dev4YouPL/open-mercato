import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import {
  buildCustomFieldResetMap,
  loadCustomFieldSnapshot,
  type CustomFieldSnapshot,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { BOM_ENTITY_ID } from './entity-ids'

export { BOM_ENTITY_ID } from './entity-ids'

type BomScope = { tenantId: string; organizationId: string }

export type { CustomFieldSnapshot }

/**
 * Custom-field values live outside the BOM aggregate tables, so they are read
 * and written around the graph-locked transaction rather than inside it — the
 * lock exists to serialize the `produce` dependency graph, which this data
 * cannot affect.
 */
export async function readBomCustomFields(
  em: EntityManager,
  scope: BomScope,
  bomId: string,
): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: BOM_ENTITY_ID,
    recordId: bomId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

export async function writeBomCustomFields(
  ctx: CommandRuntimeContext,
  scope: BomScope,
  bomId: string,
  values: Record<string, unknown> | undefined,
): Promise<void> {
  if (!values || !Object.keys(values).length) return
  const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: BOM_ENTITY_ID,
    recordId: bomId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    values,
  })
}

export async function restoreBomCustomFields(
  ctx: CommandRuntimeContext,
  scope: BomScope,
  bomId: string,
  before: CustomFieldSnapshot | undefined,
  after: CustomFieldSnapshot | undefined,
): Promise<void> {
  const reset = buildCustomFieldResetMap(before, after)
  if (!Object.keys(reset).length) return
  await writeBomCustomFields(ctx, scope, bomId, reset)
}
