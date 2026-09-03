import type { EntityManager } from '@mikro-orm/postgresql'
import { ManufacturingBomLine } from '../../data/entities'
import { BomDomainError } from './errors'

const START_POSITION = 1024n
const GAP = 1024n
const MAX_POSITION = 9007199254740991n

/**
 * Append-only position allocator: max(live position in revision) + 1024,
 * or 1024 for the first line. Delete leaves gaps on purpose (undo restores
 * the exact position); create never fills them.
 */
export async function nextAppendPosition(em: EntityManager, revisionId: string): Promise<string> {
  const row = await em
    .getKysely<any>()
    .selectFrom('manufacturing_bom_lines')
    .select((eb) => eb.fn.max('position').as('maxPosition'))
    .where('revision_id', '=', revisionId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  const current = row?.maxPosition != null ? BigInt(String(row.maxPosition)) : null
  const next = current === null ? START_POSITION : current + GAP
  if (next > MAX_POSITION) throw new BomDomainError('bom.position_exhausted')
  return next.toString()
}

/**
 * Swap two adjacent live lines through an unused temporary position value in
 * three statements, avoiding a transient collision with the partial unique
 * `(revision_id, position)` index.
 */
export async function swapLinePositions(
  em: EntityManager,
  params: { revisionId: string; line: ManufacturingBomLine; adjacent: ManufacturingBomLine },
): Promise<void> {
  const { line, adjacent } = params
  const originalLinePosition = line.position
  const originalAdjacentPosition = adjacent.position
  const temporaryPosition = await nextAppendPosition(em, params.revisionId)

  line.position = temporaryPosition
  await em.flush()

  adjacent.position = originalLinePosition
  await em.flush()

  line.position = originalAdjacentPosition
  await em.flush()
}
