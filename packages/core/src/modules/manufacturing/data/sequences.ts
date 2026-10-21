import type { EntityManager } from '@mikro-orm/postgresql'

export type SequenceTable = 'manufacturing_order_sequences' | 'manufacturing_execution_sequences'

type SequenceRow = { sequence: number | string }

function claimSql(table: SequenceTable): string {
  return `
    insert into ${table} (id, organization_id, tenant_id, next_number, created_at, updated_at)
    values (gen_random_uuid(), ?, ?, 2, now(), now())
    on conflict (tenant_id, organization_id)
    do update set next_number = ${table}.next_number + 1, updated_at = now()
    returning next_number - 1 as sequence
  `
}

export async function claimSequence(
  em: EntityManager,
  table: SequenceTable,
  organizationId: string,
  tenantId: string,
): Promise<number> {
  const rows = await em.execute<SequenceRow[]>(claimSql(table), [organizationId, tenantId], 'all')
  const sequence = Number(rows[0]?.sequence)

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`[internal] ${table} returned sequence ${String(rows[0]?.sequence)}`)
  }

  return sequence
}
