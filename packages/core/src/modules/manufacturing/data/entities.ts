import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { OperationAction, OperationStatus } from '../domain/operation'

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
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'movementId' | 'rejectionCode' | 'rejectionMessage'

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
