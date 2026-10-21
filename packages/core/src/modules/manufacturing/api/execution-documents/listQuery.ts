import { z } from 'zod'
import {
  executionDocumentListItemSchema,
  type ExecutionDocumentListItem,
  type ListExecutionDocumentsQuery,
} from '../../data/validators'

export const EXECUTION_DOCUMENT_LIST_FIELDS = [
  'id',
  'organization_id',
  'tenant_id',
  'document_type',
  'execution_id',
  'order_id',
  'operation_id',
  'posted_by',
  'posted_at',
  'reverses_document_id',
]

const listRowSchema = z.object({
  id: z.string(),
  document_type: z.string(),
  execution_id: z.string(),
  order_id: z.string().nullable().optional(),
  operation_id: z.string(),
  posted_by: z.string(),
  posted_at: z.union([z.string(), z.date()]),
  reverses_document_id: z.string().nullable().optional(),
})

export function buildExecutionDocumentFilters(query: ListExecutionDocumentsQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  if (query.executionId) filters.execution_id = { $eq: query.executionId }
  if (query.orderId) filters.order_id = { $eq: query.orderId }

  return filters
}

export function toExecutionDocumentListItem(row: unknown): ExecutionDocumentListItem {
  const parsed = listRowSchema.parse(row)

  return executionDocumentListItemSchema.parse({
    id: parsed.id,
    documentType: parsed.document_type,
    executionId: parsed.execution_id,
    orderId: parsed.order_id ?? null,
    operationId: parsed.operation_id,
    postedBy: parsed.posted_by,
    postedAt: new Date(parsed.posted_at).toISOString(),
    reversesDocumentId: parsed.reverses_document_id ?? null,
    reversedByDocumentId: null,
    facts: [],
  })
}
