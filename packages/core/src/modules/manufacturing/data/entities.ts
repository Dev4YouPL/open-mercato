import { OptionalProps } from '@mikro-orm/core'
import { Check, Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { ExecutionDocumentType, PlannedFact, ProductionFactKind } from '../domain/executionDocument'
import type { MovementKind } from '../domain/movement'
import type { OperationAction, OperationStatus } from '../domain/operation'
import type { ProductionOrderStatus } from '../domain/orderExecutionPermissions'
import type { ManufacturingBomStatus } from './bomStatus'

export type { ManufacturingBomStatus } from './bomStatus'

export const MANUFACTURING_OPERATION_ID_UNIQUE = 'manufacturing_operations_operation_id_unique'
export const MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE = 'manufacturing_operations_unresolved_unique'

@Entity({ tableName: 'manufacturing_operations' })
@Unique({
  name: MANUFACTURING_OPERATION_ID_UNIQUE,
  properties: ['tenantId', 'organizationId', 'operationId'],
})
@Index({
  name: MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE,
  expression:
    `create unique index "${MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE}" on "manufacturing_operations" ("tenant_id", "organization_id", "execution_id", "action") where "status" in ('in_progress', 'unknown')`,
})
export class ManufacturingOperation {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'movementId'
    | 'rejectionCode'
    | 'rejectionMessage'
    | 'movementKind'
    | 'variantId'
    | 'warehouseId'
    | 'locationId'
    | 'quantity'
    | 'sourceDocumentId'
    | 'orderId'
    | 'documentType'
    | 'plannedFacts'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'operation_id', type: 'uuid' })
  operationId!: string

  @Property({ name: 'action', type: 'text' })
  action!: OperationAction

  @Property({ name: 'execution_id', type: 'uuid' })
  executionId!: string

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'payload_hash', type: 'text' })
  payloadHash!: string

  @Property({ name: 'requested_by', type: 'uuid' })
  requestedBy!: string

  @Property({ name: 'source_document_id', type: 'uuid', nullable: true })
  sourceDocumentId?: string | null

  @Property({ name: 'document_type', type: 'text', nullable: true })
  documentType?: ExecutionDocumentType | null

  @Property({ name: 'planned_facts', type: 'json', nullable: true })
  plannedFacts?: PlannedFact[] | null

  @Property({ name: 'movement_kind', type: 'text', nullable: true })
  movementKind?: MovementKind | null

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null

  @Property({ name: 'location_id', type: 'uuid', nullable: true })
  locationId?: string | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, nullable: true })
  quantity?: string | null

  @Property({ name: 'status', type: 'text' })
  status!: OperationStatus

  @Property({ name: 'movement_id', type: 'text', nullable: true })
  movementId?: string | null

  @Property({ name: 'rejection_code', type: 'text', nullable: true })
  rejectionCode?: string | null

  @Property({ name: 'rejection_message', type: 'text', nullable: true })
  rejectionMessage?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export const EXECUTION_DOCUMENT_OPERATION_UNIQUE = 'manufacturing_execution_documents_operation_unique'
export const EXECUTION_DOCUMENT_REVERSAL_UNIQUE = 'manufacturing_execution_documents_reversal_unique'

@Entity({ tableName: 'manufacturing_execution_documents' })
@Unique({
  name: EXECUTION_DOCUMENT_OPERATION_UNIQUE,
  properties: ['tenantId', 'organizationId', 'operationId'],
})
@Index({
  name: 'manufacturing_execution_documents_order_idx',
  properties: ['tenantId', 'organizationId', 'orderId', 'postedAt'],
})
@Index({
  name: 'manufacturing_execution_documents_execution_idx',
  properties: ['tenantId', 'organizationId', 'executionId', 'postedAt'],
})
@Index({
  name: EXECUTION_DOCUMENT_REVERSAL_UNIQUE,
  expression:
    `create unique index "${EXECUTION_DOCUMENT_REVERSAL_UNIQUE}" on "manufacturing_execution_documents" ("tenant_id", "organization_id", "reverses_document_id") where "reverses_document_id" is not null`,
})
export class ExecutionDocument {
  [OptionalProps]?: 'createdAt' | 'reversesDocumentId' | 'orderId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_type', type: 'text' })
  documentType!: ExecutionDocumentType

  @Property({ name: 'execution_id', type: 'uuid' })
  executionId!: string

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'operation_id', type: 'uuid' })
  operationId!: string

  @Property({ name: 'posted_by', type: 'uuid' })
  postedBy!: string

  @Property({ name: 'reverses_document_id', type: 'uuid', nullable: true })
  reversesDocumentId?: string | null

  @Property({ name: 'posted_at', type: Date })
  postedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'manufacturing_production_facts' })
@Index({ name: 'manufacturing_production_facts_document_idx', properties: ['document'] })
export class ProductionFact {
  [OptionalProps]?: 'createdAt' | 'movementId' | 'warehouseId' | 'locationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => ExecutionDocument, { fieldName: 'document_id' })
  document!: ExecutionDocument

  @Property({ name: 'fact_kind', type: 'text' })
  factKind!: ProductionFactKind

  @Property({ name: 'variant_id', type: 'uuid' })
  variantId!: string

  @Property({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null

  @Property({ name: 'location_id', type: 'uuid', nullable: true })
  locationId?: string | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4 })
  quantity!: string

  @Property({ name: 'movement_id', type: 'text', nullable: true })
  movementId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export const PRODUCTION_ORDER_NUMBER_UNIQUE = 'manufacturing_production_orders_number_unique'

@Entity({ tableName: 'manufacturing_production_orders' })
@Unique({
  name: PRODUCTION_ORDER_NUMBER_UNIQUE,
  properties: ['tenantId', 'organizationId', 'orderNumber'],
})
@Index({ name: 'manufacturing_production_orders_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
@Index({
  name: 'manufacturing_production_orders_variant_idx',
  properties: ['tenantId', 'organizationId', 'productVariantId'],
})
export class ProductionOrder {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'dueAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'order_number', type: 'text' })
  orderNumber!: string

  @Property({ name: 'product_variant_id', type: 'uuid' })
  productVariantId!: string

  @Property({ name: 'bom_revision_id', type: 'uuid' })
  bomRevisionId!: string

  @Property({ name: 'planned_quantity', type: 'numeric', precision: 18, scale: 4 })
  plannedQuantity!: string

  @Property({ name: 'source_location_id', type: 'uuid' })
  sourceLocationId!: string

  @Property({ name: 'target_location_id', type: 'uuid' })
  targetLocationId!: string

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: ProductionOrderStatus = 'draft'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'manufacturing_order_sequences' })
@Unique({
  name: 'manufacturing_order_sequences_scope_unique',
  properties: ['tenantId', 'organizationId'],
})
export class ProductionOrderSequence {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'nextNumber'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'next_number', type: 'int', default: 1 })
  nextNumber: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export const PRODUCTION_EXECUTION_NUMBER_UNIQUE = 'manufacturing_executions_number_unique'

@Entity({ tableName: 'manufacturing_executions' })
@Unique({
  name: PRODUCTION_EXECUTION_NUMBER_UNIQUE,
  properties: ['tenantId', 'organizationId', 'executionNumber'],
})
@Index({ name: 'manufacturing_executions_order_idx', properties: ['tenantId', 'organizationId', 'orderId'] })
export class ProductionExecution {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'orderId'
    | 'productVariantId'
    | 'sourceLocationId'
    | 'targetLocationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'execution_number', type: 'text' })
  executionNumber!: string

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'product_variant_id', type: 'uuid', nullable: true })
  productVariantId?: string | null

  @Property({ name: 'source_location_id', type: 'uuid', nullable: true })
  sourceLocationId?: string | null

  @Property({ name: 'target_location_id', type: 'uuid', nullable: true })
  targetLocationId?: string | null

  @Property({ name: 'created_by', type: 'uuid' })
  createdBy!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'manufacturing_execution_sequences' })
@Unique({
  name: 'manufacturing_execution_sequences_scope_unique',
  properties: ['tenantId', 'organizationId'],
})
export class ProductionExecutionSequence {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'nextNumber'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'next_number', type: 'int', default: 1 })
  nextNumber: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'manufacturing_boms' })
@Index({
  name: 'manufacturing_boms_org_tenant_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'manufacturing_boms_variant_revision_unique',
  properties: [
    'tenantId',
    'organizationId',
    'outputVariantId',
    'revision',
  ],
})
@Check({
  name: 'manufacturing_boms_base_quantity_positive_chk',
  expression: '"base_quantity" > 0',
})
export class ManufacturingBom{
    [OptionalProps]?: 'status' | 'isIncomplete' | 'isAvailableForNewOrders' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

    @Property({ name: 'is_incomplete', type: 'boolean', default: false })
    isIncomplete: boolean = false

    @Property({ name: 'is_available_for_new_orders', type: 'boolean', default: true })
    isAvailableForNewOrders: boolean = true

    @Property({ name: 'released_at', type: Date, nullable: true })
    releasedAt?: Date | null

    @Property({ name: 'released_by_user_id', type: 'uuid', nullable: true })
    releasedByUserId?: string | null

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
