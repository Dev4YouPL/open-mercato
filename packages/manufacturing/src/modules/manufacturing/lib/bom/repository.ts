import type { EntityManager } from '@mikro-orm/postgresql'
import { ManufacturingBom, ManufacturingBomLine, ManufacturingBomRevision } from '../../data/entities'
import { decodeBomCursor, decodeLineCursor, encodeBomCursor, encodeLineCursor, filterDigest } from './cursor'

export type ScopedParams = { tenantId: string; organizationId: string }

/**
 * Raw keyset rows come back through Kysely, which hands `timestamptz` columns
 * over as strings. `em.map` validates against the entity's declared `Date`
 * type and rejects a string, so every raw timestamp is coerced here before
 * hydration.
 */
export function toEntityDate(value: unknown): Date {
  if (value instanceof Date) return value
  return new Date(value as string | number)
}

export async function loadActiveDraft(
  em: EntityManager,
  params: ScopedParams & { bomId: string },
): Promise<{ bom: ManufacturingBom; revision: ManufacturingBomRevision } | null> {
  const bom = await em.findOne(ManufacturingBom, {
    id: params.bomId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
  if (!bom) return null
  const revision = await em.findOne(ManufacturingBomRevision, {
    bom: bom.id,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    status: 'draft',
    deletedAt: null,
  })
  if (!revision) return null
  return { bom, revision }
}

export type BomListPage = {
  items: Array<{ bom: ManufacturingBom; revision: ManufacturingBomRevision; lineCount: number; unresolvedProduceCount: number }>
  nextCursor: string | null
  hasMore: boolean
}

export async function listActiveDrafts(
  em: EntityManager,
  params: ScopedParams & { limit: number; cursorToken?: string; productId?: string; variantId?: string },
): Promise<BomListPage> {
  const digest = filterDigest({ productId: params.productId, variantId: params.variantId })
  const cursor = decodeBomCursor(params.cursorToken)
  if (
    params.cursorToken &&
    (!cursor ||
      cursor.tenantId !== params.tenantId ||
      cursor.organizationId !== params.organizationId ||
      cursor.pageSize !== params.limit ||
      cursor.filterDigest !== digest)
  ) {
    return { items: [], nextCursor: null, hasMore: false }
  }

  const db = em.getKysely<any>()
  let query = db
    .selectFrom('manufacturing_boms as b')
    .innerJoin('manufacturing_bom_revisions as r', (join: any) => join.onRef('r.bom_id', '=', 'b.id').on('r.status', '=', 'draft').on('r.deleted_at', 'is', null))
    .select([
      'b.id as bom_id',
      'b.organization_id as organization_id',
      'b.tenant_id as tenant_id',
      'b.product_id as product_id',
      'b.variant_id as variant_id',
      'b.next_revision_number as next_revision_number',
      'b.created_at as created_at',
      'b.updated_at as updated_at',
      'r.id as revision_id',
      'r.revision_number as revision_number',
      'r.revision_label as revision_label',
      'r.base_output_entered_quantity as base_output_entered_quantity',
      'r.base_output_entered_unit_code as base_output_entered_unit_code',
      'r.base_output_normalized_quantity as base_output_normalized_quantity',
      'r.base_output_normalized_unit_code as base_output_normalized_unit_code',
      'r.base_output_uom_snapshot as base_output_uom_snapshot',
      'r.updated_at as revision_updated_at',
    ])
    .where('b.tenant_id', '=', params.tenantId)
    .where('b.organization_id', '=', params.organizationId)
    .where('b.deleted_at', 'is', null)
    .orderBy('b.updated_at', 'desc')
    .orderBy('b.id', 'desc')
    .limit(params.limit + 1)

  if (params.productId) query = query.where('b.product_id', '=', params.productId)
  if (params.variantId) query = query.where('b.variant_id', '=', params.variantId)
  if (cursor) {
    query = query.where((eb: any) =>
      eb.or([
        eb('b.updated_at', '<', new Date(cursor.updatedAt)),
        eb.and([eb('b.updated_at', '=', new Date(cursor.updatedAt)), eb('b.id', '<', cursor.id)]),
      ]),
    )
  }

  const rows = await query.execute()
  const hasMore = rows.length > params.limit
  const page = hasMore ? rows.slice(0, params.limit) : rows

  const items = await Promise.all(
    page.map(async (row: any) => {
      const [lineCount, unresolvedProduceCount] = (await Promise.all([
        db
          .selectFrom('manufacturing_bom_lines')
          .select((eb: any) => eb.fn.countAll().as('count'))
          .where('revision_id', '=', row.revision_id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst(),
        db
          .selectFrom('manufacturing_bom_lines')
          .select((eb: any) => eb.fn.countAll().as('count'))
          .where('revision_id', '=', row.revision_id)
          .where('deleted_at', 'is', null)
          .where('supply_mode', '=', 'produce')
          .executeTakeFirst(),
      ])) as Array<{ count: string | number } | undefined>
      const bom = em.map(ManufacturingBom, {
        id: row.bom_id,
        organizationId: row.organization_id,
        tenantId: row.tenant_id,
        productId: row.product_id,
        variantId: row.variant_id,
        nextRevisionNumber: row.next_revision_number,
        createdAt: toEntityDate(row.created_at),
        updatedAt: toEntityDate(row.updated_at),
        deletedAt: null,
      })
      const revision = em.map(ManufacturingBomRevision, {
        id: row.revision_id,
        bom: row.bom_id,
        organizationId: row.organization_id,
        tenantId: row.tenant_id,
        revisionNumber: row.revision_number,
        revisionLabel: row.revision_label,
        status: 'draft',
        baseOutputEnteredQuantity: row.base_output_entered_quantity,
        baseOutputEnteredUnitCode: row.base_output_entered_unit_code,
        baseOutputNormalizedQuantity: row.base_output_normalized_quantity,
        baseOutputNormalizedUnitCode: row.base_output_normalized_unit_code,
        baseOutputUomSnapshot: row.base_output_uom_snapshot,
        createdAt: toEntityDate(row.created_at),
        updatedAt: toEntityDate(row.revision_updated_at),
        deletedAt: null,
      })
      return {
        bom,
        revision,
        lineCount: Number(lineCount?.count ?? 0),
        unresolvedProduceCount: Number(unresolvedProduceCount?.count ?? 0),
      }
    }),
  )

  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeBomCursor({
          updatedAt: new Date(last.updated_at).toISOString(),
          id: last.bom_id,
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          pageSize: params.limit,
          filterDigest: digest,
        })
      : null

  return { items, nextCursor, hasMore }
}

export type LineListPage = {
  items: ManufacturingBomLine[]
  nextCursor: string | null
  hasMore: boolean
  staleCursor: boolean
}

export async function listLines(
  em: EntityManager,
  params: ScopedParams & { bomId: string; revisionId: string; revisionUpdatedAt: Date; limit: number; cursorToken?: string },
): Promise<LineListPage> {
  const cursor = decodeLineCursor(params.cursorToken)
  if (params.cursorToken) {
    if (
      !cursor ||
      cursor.tenantId !== params.tenantId ||
      cursor.organizationId !== params.organizationId ||
      cursor.bomId !== params.bomId ||
      cursor.pageSize !== params.limit
    ) {
      return { items: [], nextCursor: null, hasMore: false, staleCursor: true }
    }
    if (cursor.revisionId !== params.revisionId || cursor.revisionUpdatedAt !== params.revisionUpdatedAt.toISOString()) {
      return { items: [], nextCursor: null, hasMore: false, staleCursor: true }
    }
  }

  const qb = em.qb(ManufacturingBomLine, 'l')
  qb.where({
    revision: params.revisionId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
  if (cursor) {
    qb.andWhere({
      $or: [
        { position: { $gt: cursor.position } },
        { position: cursor.position, id: { $gt: cursor.id } },
      ],
    })
  }
  qb.orderBy({ position: 'asc', id: 'asc' }).limit(params.limit + 1)
  const rows = await qb.getResult()

  const hasMore = rows.length > params.limit
  const items = hasMore ? rows.slice(0, params.limit) : rows
  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeLineCursor({
          position: last.position,
          id: last.id,
          bomId: params.bomId,
          revisionId: params.revisionId,
          revisionUpdatedAt: params.revisionUpdatedAt.toISOString(),
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          pageSize: params.limit,
        })
      : null

  return { items, nextCursor, hasMore, staleCursor: false }
}
