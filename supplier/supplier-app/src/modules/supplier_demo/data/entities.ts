import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type SupplyCaseStatus =
  | 'detected'
  | 'proposal_ready'
  | 'proposal_queued'
  | 'proposal_delivered'
  | 'escalated'
  | 'blocked_recipient'
  | 'send_failed'

export type SupplyMessageDeliveryStatus =
  | 'pending'
  | 'sending'
  | 'queued_in_hub'
  | 'delivered'
  | 'delivery_failed'
  | 'enqueue_failed'

export type SupplyCommitment = {
  quantity: number
  date: string
}

export type SupplierProductionAllocation = {
  orderNumber: string
  quantity: number
  priority: 'normal' | 'high'
  slaDueAt: string
  shiftableHours: number
  shiftCostPerHour: number
}

@Entity({ tableName: 'supplier_demo_supply_cases' })
@Index({ name: 'supplier_demo_supply_cases_scope_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
@Index({
  name: 'supplier_demo_supply_cases_order_uq',
  expression:
    'create unique index "supplier_demo_supply_cases_order_uq" on "supplier_demo_supply_cases" ("tenant_id", "organization_id", "sales_order_id") where "deleted_at" is null',
})
@Index({
  name: 'supplier_demo_supply_cases_correlation_uq',
  expression:
    'create unique index "supplier_demo_supply_cases_correlation_uq" on "supplier_demo_supply_cases" ("tenant_id", "organization_id", "correlation_id") where "deleted_at" is null',
})
export class SupplyCase {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'correlation_id', type: 'text' })
  correlationId!: string

  @Property({ name: 'sales_order_id', type: 'uuid' })
  salesOrderId!: string

  @Property({ name: 'order_number', type: 'text' })
  orderNumber!: string

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'customer_snapshot', type: 'json', nullable: true })
  customerSnapshot?: Record<string, unknown> | null

  @Property({ name: 'customer_display_name', type: 'text', nullable: true })
  customerDisplayName?: string | null

  @Property({ name: 'recipient_email', type: 'text', nullable: true })
  recipientEmail?: string | null

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ type: 'text' })
  sku!: string

  @Property({ type: 'text', default: 'wms_shortfall' })
  trigger: 'wms_shortfall' | 'manual_disruption' = 'wms_shortfall'

  @Property({ type: 'text', default: 'detected' })
  status: SupplyCaseStatus = 'detected'

  @Property({ name: 'status_reason', type: 'text', nullable: true })
  statusReason?: string | null

  @Property({ name: 'original_commitment', type: 'json' })
  originalCommitment: SupplyCommitment[] = []

  @Property({ name: 'baseline_commitment', type: 'json' })
  baselineCommitment: SupplyCommitment[] = []

  @Property({ name: 'current_commitment', type: 'json' })
  currentCommitment: SupplyCommitment[] = []

  @Property({ name: 'plan_summary', type: 'json', nullable: true })
  planSummary?: Record<string, unknown> | null

  @Property({ name: 'risk_level', type: 'text', nullable: true })
  riskLevel?: string | null

  @Property({ name: 'policy_decision', type: 'text', nullable: true })
  policyDecision?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'PLN' })
  currencyCode: string = 'PLN'

  @Property({ name: 'additional_cost', type: 'numeric', precision: 12, scale: 2, nullable: true })
  additionalCost?: string | null

  @Property({ name: 'negotiation_turn', type: 'integer', default: 0 })
  negotiationTurn = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'supplier_demo_supply_messages' })
@Index({ name: 'supplier_demo_supply_messages_case_idx', properties: ['tenantId', 'organizationId', 'supplyCaseId'] })
@Index({ name: 'supplier_demo_supply_messages_comm_message_idx', properties: ['tenantId', 'organizationId', 'commMessageId'] })
@Index({
  name: 'supplier_demo_supply_messages_business_id_uq',
  expression:
    'create unique index "supplier_demo_supply_messages_business_id_uq" on "supplier_demo_supply_messages" ("tenant_id", "organization_id", "business_message_id") where "deleted_at" is null',
})
export class SupplyMessage {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'supply_case_id', type: 'uuid' })
  supplyCaseId!: string

  @Property({ name: 'business_message_id', type: 'text' })
  businessMessageId!: string

  @Property({ type: 'text', default: 'outbound' })
  direction: 'outbound' = 'outbound'

  @Property({ name: 'message_type', type: 'text', default: 'SUPPLY_PROPOSAL' })
  messageType: 'SUPPLY_PROPOSAL' = 'SUPPLY_PROPOSAL'

  @Property({ name: 'sender_email', type: 'text', nullable: true })
  senderEmail?: string | null

  @Property({ name: 'recipient_email', type: 'text', nullable: true })
  recipientEmail?: string | null

  @Property({ type: 'text' })
  subject!: string

  @Property({ name: 'envelope_payload', type: 'json' })
  envelopePayload: Record<string, unknown> = {}

  @Property({ name: 'delivery_status', type: 'text', default: 'pending' })
  deliveryStatus: SupplyMessageDeliveryStatus = 'pending'

  @Property({ name: 'comm_message_id', type: 'uuid', nullable: true })
  commMessageId?: string | null

  @Property({ name: 'comm_thread_id', type: 'uuid', nullable: true })
  commThreadId?: string | null

  @Property({ name: 'comm_channel_id', type: 'uuid', nullable: true })
  commChannelId?: string | null

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ type: 'integer', default: 0 })
  attempts = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'supplier_demo_production_slots' })
@Index({ name: 'supplier_demo_production_slots_scope_variant_idx', properties: ['tenantId', 'organizationId', 'catalogVariantId', 'startsAt'] })
@Index({
  name: 'supplier_demo_production_slots_variant_date_uq',
  expression:
    'create unique index "supplier_demo_production_slots_variant_date_uq" on "supplier_demo_production_slots" ("tenant_id", "organization_id", "catalog_variant_id", "starts_at") where "deleted_at" is null',
})
export class SupplierProductionSlot {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ name: 'starts_at', type: Date })
  startsAt!: Date

  @Property({ name: 'capacity_quantity', type: 'integer' })
  capacityQuantity!: number

  @Property({ type: 'json' })
  allocations: SupplierProductionAllocation[] = []

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
