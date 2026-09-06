import { BigIntType, OptionalProps } from '@mikro-orm/core'
import {
  Check,
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy'
import type { BomQuantityNormalizationSnapshot } from '../lib/bom/quantity'

export type BomConsumptionBasis = 'variable' | 'fixed'
export type BomSupplyMode = 'stock' | 'produce'
export type BomRevisionStatus = 'draft'

type BomOptionalProps = 'createdAt' | 'updatedAt' | 'deletedAt'

@Entity({ tableName: 'manufacturing_boms' })
@Index({ name: 'manufacturing_boms_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'manufacturing_boms_scope_unique_idx',
  expression:
    'create unique index "manufacturing_boms_scope_unique_idx" on "manufacturing_boms" ("id", "tenant_id", "organization_id")',
})
@Index({
  name: 'manufacturing_boms_product_target_unique_idx',
  expression:
    'create unique index "manufacturing_boms_product_target_unique_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id") where "deleted_at" is null and "variant_id" is null',
})
@Index({
  name: 'manufacturing_boms_variant_target_unique_idx',
  expression:
    'create unique index "manufacturing_boms_variant_target_unique_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id", "variant_id") where "deleted_at" is null and "variant_id" is not null',
})
@Index({
  name: 'manufacturing_boms_keyset_idx',
  expression:
    'create index "manufacturing_boms_keyset_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "updated_at" desc, "id" desc) where "deleted_at" is null',
})
@Index({
  name: 'manufacturing_boms_product_keyset_idx',
  expression:
    'create index "manufacturing_boms_product_keyset_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id", "updated_at" desc, "id" desc) where "deleted_at" is null',
})
@Index({
  name: 'manufacturing_boms_resolution_idx',
  expression:
    'create index "manufacturing_boms_resolution_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id", "variant_id") where "deleted_at" is null',
})
@Check({ name: 'manufacturing_boms_next_revision_chk', expression: '"next_revision_number" >= 2' })
export class ManufacturingBom {
  [OptionalProps]?: BomOptionalProps | 'variantId' | 'nextRevisionNumber'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'next_revision_number', type: 'integer', default: 2 })
  nextRevisionNumber: number = 2

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  /**
   * Aggregate-adjacent audit timestamp bumped monotonically by every command
   * (see lib/bom/version.ts) — no onUpdate hook, so the explicit value the
   * command computes is never silently overwritten at flush time.
   */
  @Property({ name: 'updated_at', type: Date })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'manufacturing_bom_revisions' })
@Index({
  name: 'manufacturing_bom_revisions_scope_unique_idx',
  expression:
    'create unique index "manufacturing_bom_revisions_scope_unique_idx" on "manufacturing_bom_revisions" ("id", "tenant_id", "organization_id")',
})
@Index({
  name: 'manufacturing_bom_revisions_number_unique_idx',
  expression:
    'create unique index "manufacturing_bom_revisions_number_unique_idx" on "manufacturing_bom_revisions" ("bom_id", "revision_number")',
})
@Index({
  name: 'manufacturing_bom_revisions_active_draft_unique_idx',
  expression:
    'create unique index "manufacturing_bom_revisions_active_draft_unique_idx" on "manufacturing_bom_revisions" ("bom_id") where "deleted_at" is null and "status" = \'draft\'',
})
@Index({
  name: 'manufacturing_bom_revisions_scope_lookup_idx',
  expression:
    'create index "manufacturing_bom_revisions_scope_lookup_idx" on "manufacturing_bom_revisions" ("tenant_id", "organization_id", "bom_id", "status") where "deleted_at" is null',
})
@Check({ name: 'manufacturing_bom_revisions_status_chk', expression: `"status" = 'draft'` })
@Check({ name: 'manufacturing_bom_revisions_number_chk', expression: '"revision_number" > 0' })
@Check({ name: 'manufacturing_bom_revisions_label_len_chk', expression: 'char_length("revision_label") <= 120' })
@Check({
  name: 'manufacturing_bom_revisions_base_output_positive_chk',
  expression: '"base_output_entered_quantity" > 0 and "base_output_normalized_quantity" > 0',
})
@Check({
  name: 'manufacturing_bom_revisions_snapshot_version_chk',
  expression: `("base_output_uom_snapshot"->>'version')::int = 1`,
})
@Check({
  name: 'manufacturing_bom_revisions_snapshot_consistency_chk',
  expression:
    '"base_output_entered_quantity" = ("base_output_uom_snapshot"->>\'enteredQuantity\')::numeric ' +
    'and "base_output_normalized_quantity" = ("base_output_uom_snapshot"->>\'normalizedQuantity\')::numeric ' +
    'and "base_output_entered_unit_code" = "base_output_uom_snapshot"->>\'enteredUnitCode\' ' +
    'and "base_output_normalized_unit_code" = "base_output_uom_snapshot"->>\'baseUnitCode\'',
})
export class ManufacturingBomRevision {
  [OptionalProps]?: BomOptionalProps | 'revisionLabel' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => ManufacturingBom, { fieldName: 'bom_id', deleteRule: 'restrict' })
  bom!: ManufacturingBom

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'revision_number', type: 'integer' })
  revisionNumber!: number

  @Property({ name: 'revision_label', type: 'text', nullable: true })
  revisionLabel?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: BomRevisionStatus = 'draft'

  @Property({ name: 'base_output_entered_quantity', type: 'numeric', precision: 18, scale: 6 })
  baseOutputEnteredQuantity!: string

  @Property({ name: 'base_output_entered_unit_code', type: 'text' })
  baseOutputEnteredUnitCode!: string

  @Property({ name: 'base_output_normalized_quantity', type: 'numeric', precision: 18, scale: 6 })
  baseOutputNormalizedQuantity!: string

  @Property({ name: 'base_output_normalized_unit_code', type: 'text' })
  baseOutputNormalizedUnitCode!: string

  @Property({ name: 'base_output_uom_snapshot', type: 'jsonb' })
  baseOutputUomSnapshot!: BomQuantityNormalizationSnapshot

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  /** Aggregate optimistic-lock token — bumped monotonically, no onUpdate hook (see lib/bom/version.ts). */
  @Property({ name: 'updated_at', type: Date })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'manufacturing_bom_lines' })
@Index({
  name: 'manufacturing_bom_lines_position_unique_idx',
  expression:
    'create unique index "manufacturing_bom_lines_position_unique_idx" on "manufacturing_bom_lines" ("revision_id", "position") where "deleted_at" is null',
})
@Index({
  name: 'manufacturing_bom_lines_ordered_read_idx',
  expression:
    'create index "manufacturing_bom_lines_ordered_read_idx" on "manufacturing_bom_lines" ("tenant_id", "organization_id", "revision_id", "position", "id") where "deleted_at" is null',
})
@Index({
  name: 'manufacturing_bom_lines_graph_lookup_idx',
  expression:
    'create index "manufacturing_bom_lines_graph_lookup_idx" on "manufacturing_bom_lines" ("tenant_id", "organization_id", "component_product_id", "component_variant_id") where "deleted_at" is null and "supply_mode" = \'produce\'',
})
@Index({
  name: 'manufacturing_bom_lines_unresolved_idx',
  expression:
    'create index "manufacturing_bom_lines_unresolved_idx" on "manufacturing_bom_lines" ("tenant_id", "organization_id", "revision_id") where "deleted_at" is null and "supply_mode" = \'produce\'',
})
@Check({
  name: 'manufacturing_bom_lines_basis_chk',
  expression: `"consumption_basis" in ('variable', 'fixed')`,
})
@Check({ name: 'manufacturing_bom_lines_supply_chk', expression: `"supply_mode" in ('stock', 'produce')` })
@Check({
  name: 'manufacturing_bom_lines_yield_chk',
  expression: '"yield_factor" > 0 and "yield_factor" <= 1',
})
@Check({
  name: 'manufacturing_bom_lines_quantity_positive_chk',
  expression: '"entered_quantity" > 0 and "normalized_quantity" > 0',
})
@Check({
  name: 'manufacturing_bom_lines_position_range_chk',
  expression: '"position" > 0 and "position" <= 9007199254740991',
})
@Check({
  name: 'manufacturing_bom_lines_snapshot_version_chk',
  expression: `("uom_snapshot"->>'version')::int = 1`,
})
@Check({
  name: 'manufacturing_bom_lines_snapshot_consistency_chk',
  expression:
    '"entered_quantity" = ("uom_snapshot"->>\'enteredQuantity\')::numeric ' +
    'and "normalized_quantity" = ("uom_snapshot"->>\'normalizedQuantity\')::numeric ' +
    'and "entered_unit_code" = "uom_snapshot"->>\'enteredUnitCode\' ' +
    'and "normalized_unit_code" = "uom_snapshot"->>\'baseUnitCode\'',
})
export class ManufacturingBomLine {
  [OptionalProps]?: BomOptionalProps | 'componentVariantId' | 'consumptionBasis' | 'yieldFactor' | 'supplyMode'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => ManufacturingBomRevision, { fieldName: 'revision_id', deleteRule: 'restrict' })
  revision!: ManufacturingBomRevision

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'component_product_id', type: 'uuid' })
  componentProductId!: string

  @Property({ name: 'component_variant_id', type: 'uuid', nullable: true })
  componentVariantId?: string | null

  @Property({ name: 'entered_quantity', type: 'numeric', precision: 18, scale: 6 })
  enteredQuantity!: string

  @Property({ name: 'entered_unit_code', type: 'text' })
  enteredUnitCode!: string

  @Property({ name: 'normalized_quantity', type: 'numeric', precision: 18, scale: 6 })
  normalizedQuantity!: string

  @Property({ name: 'normalized_unit_code', type: 'text' })
  normalizedUnitCode!: string

  @Property({ name: 'uom_snapshot', type: 'jsonb' })
  uomSnapshot!: BomQuantityNormalizationSnapshot

  @Property({ name: 'consumption_basis', type: 'text', default: 'variable' })
  consumptionBasis: BomConsumptionBasis = 'variable'

  @Property({ name: 'yield_factor', type: 'numeric', precision: 18, scale: 12, default: '1' })
  yieldFactor: string = '1'

  @Property({ name: 'supply_mode', type: 'text', default: 'stock' })
  supplyMode: BomSupplyMode = 'stock'

  /**
   * `bigint` in Postgres, but string-typed in JS: the position travels through
   * command action-log payloads, which are JSON-serialised. A native BigInt
   * would make that serialisation throw, so the column is read back as a
   * string (see lib/bom/position.ts).
   */
  @Property({ name: 'position', type: new BigIntType('string') })
  position!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
