import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { ExecutionDocumentType, PlannedFact, ProductionFactKind } from '../domain/executionDocument'
import type { MovementKind } from '../domain/movement'
import type { OperationAction, OperationStatus } from '../domain/operation'
import type { ProductionOrderStatus } from '../domain/orderExecutionPermissions'

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
    `create unique index "${MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE}" on "manufacturing_operations" ("tenant_id", "organization_id", "order_id", "action") where "status" in ('in_progress', 'unknown')`,
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

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

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
  name: EXECUTION_DOCUMENT_REVERSAL_UNIQUE,
  expression:
    `create unique index "${EXECUTION_DOCUMENT_REVERSAL_UNIQUE}" on "manufacturing_execution_documents" ("tenant_id", "organization_id", "reverses_document_id") where "reverses_document_id" is not null`,
})
export class ExecutionDocument {
  [OptionalProps]?: 'createdAt' | 'reversesDocumentId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_type', type: 'text' })
  documentType!: ExecutionDocumentType

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

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
