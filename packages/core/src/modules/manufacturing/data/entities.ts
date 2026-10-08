import {
  Check,
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy'

import { OptionalProps } from '@mikro-orm/core'

import type { ManufacturingBomStatus } from './bomStatus'

export type { ManufacturingBomStatus } from './bomStatus'

@Entity({ tableName: 'manufacturing_boms' })
@Index({
  name: 'manufacturing_boms_org_tenant_idx',
  properties: ['organizationId', 'tenantId'],
})
@Check({
  name: 'manufacturing_boms_base_quantity_positive_chk',
  expression: '"base_quantity" > 0',
})
export class ManufacturingBom{
    [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

    @PrimaryKey({type: 'uuid', defaultRaw: 'gen_random_uuid()'})
    id!: string

    @Property({name: 'organization_id', type: 'uuid'})
    organizationId!: string

    @Property({name: 'tenant_id', type: 'uuid'})
    tenantId!: string

    @Property({name: 'output_variant_id', type: 'uuid'})
    outputVariantId!: string
    
    @Property({name: 'base_quantity', type: 'numeric', precision: 16, scale: 6})
    baseQuantity!: string

    @Property({name: 'revision', type: 'text'})
    revision!: string

    @Property({name: 'status', type: 'text', default: 'draft'})
    status: ManufacturingBomStatus = 'draft'

    @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
    createdAt: Date = new Date()

    @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
    updatedAt: Date = new Date()

    @Property({ name: 'deleted_at', type: Date, nullable: true })
    deletedAt?: Date | null
}

@Entity({ tableName: 'manufacturing_bom_items' })
@Index({
  name: 'manufacturing_bom_items_org_tenant_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'manufacturing_bom_items_bom_idx',
  properties: ['bom'],
})
@Check({
  name: 'manufacturing_bom_items_quantity_positive_chk',
  expression: '"quantity" > 0',
})
export class ManufacturingBomItem{
    [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

    @PrimaryKey({type: 'uuid', defaultRaw: 'gen_random_uuid()'})
    id!: string

    @Property({name: 'organization_id', type: 'uuid'})
    organizationId!: string

    @Property({name: 'tenant_id', type: 'uuid'})
    tenantId!: string

   @ManyToOne(() => ManufacturingBom, {fieldName: 'bom_id', nullable: false })
    bom!: ManufacturingBom

    @Property({ name: 'component_variant_id', type: 'uuid' })
    componentVariantId!: string

    @Property({name: 'quantity', type: 'numeric', precision: 18, scale: 6 })
    quantity!: string

    @Property({ name: 'position', type: 'integer' })
    position!: number

    @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
    createdAt: Date = new Date()

    @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
    updatedAt: Date = new Date()

    @Property({ name: 'deleted_at', type: Date, nullable: true })
    deletedAt?: Date | null
}