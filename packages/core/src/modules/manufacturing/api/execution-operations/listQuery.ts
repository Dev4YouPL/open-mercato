import { z } from 'zod'
import {
  executionOperationListItemSchema,
  type ExecutionOperationListItem,
  type ListExecutionOperationsQuery,
} from '../../data/validators'
import { UNRESOLVED_OPERATION_STATUSES } from '../../domain/operation'

export const EXECUTION_OPERATION_LIST_FIELDS = [
  'id',
  'organization_id',
  'tenant_id',
  'operation_id',
  'action',
  'execution_id',
  'status',
  'rejection_code',
  'rejection_message',
  'created_at',
  'updated_at',
]

const timestamp = z.union([z.string(), z.date()])

const listRowSchema = z.object({
  operation_id: z.string(),
  action: z.string(),
  execution_id: z.string(),
  status: z.string(),
  rejection_code: z.string().nullable().optional(),
  rejection_message: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
})

export function buildExecutionOperationFilters(query: ListExecutionOperationsQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  if (query.executionId) filters.execution_id = { $eq: query.executionId }
  if (query.unresolved === 'true') filters.status = { $in: [...UNRESOLVED_OPERATION_STATUSES] }

  return filters
}

export function toExecutionOperationListItem(row: unknown): ExecutionOperationListItem {
  const parsed = listRowSchema.parse(row)

  return executionOperationListItemSchema.parse({
    operationId: parsed.operation_id,
    action: parsed.action,
    executionId: parsed.execution_id,
    status: parsed.status,
    rejectionCode: parsed.rejection_code ?? null,
    rejectionMessage: parsed.rejection_message ?? null,
    createdAt: new Date(parsed.created_at).toISOString(),
    updatedAt: new Date(parsed.updated_at).toISOString(),
  })
}
