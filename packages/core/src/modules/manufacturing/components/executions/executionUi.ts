import { z } from 'zod'
import { parseLocaleNumber } from '@open-mercato/shared/lib/number'
import { apiCall, type ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import type { RecordExecutionOperationInput, ExecutionDocumentListItem } from '../../data/validators'
import {
  computeMaterialVariances,
  computeOutputVariance,
  type MaterialVariance,
  type OutputVariance,
} from '../../domain/variance'

export const EXECUTIONS_API_PATH = '/api/manufacturing/executions'
export const EXECUTION_DOCUMENTS_API_PATH = '/api/manufacturing/execution-documents'
export const EXECUTION_OPERATIONS_API_PATH = '/api/manufacturing/execution-operations'
export const DOCUMENT_REVERSALS_API_PATH = '/api/manufacturing/document-reversals'
export const OPERATION_RESUMPTIONS_API_PATH = '/api/manufacturing/operation-resumptions'
export const ORDERS_API_PATH = '/api/manufacturing/orders'
export const EXECUTIONS_BACKEND_PATH = '/backend/manufacturing/executions'

export type ExecutionActionKind = 'issueMaterial' | 'returnMaterial' | 'confirmProduction'

export type OperationOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; message: string }
  | { kind: 'blocked'; message: string; blockingOperationId: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'failed'; message: string }

const errorBodySchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  blockingOperationId: z.string().optional(),
})

export function readOperationOutcome(status: number, body: unknown, fallbackMessage: string): OperationOutcome {
  if (status >= 200 && status < 300) return { kind: 'accepted' }

  const parsed = errorBodySchema.safeParse(body)
  const message = (parsed.success && parsed.data.error) || fallbackMessage
  const code = parsed.success ? parsed.data.code : undefined

  if (status === 409 && code === 'operation_blocked' && parsed.success && parsed.data.blockingOperationId) {
    return { kind: 'blocked', message, blockingOperationId: parsed.data.blockingOperationId }
  }

  if (status === 503 && code === 'operation_outcome_unknown') return { kind: 'unknown', message }
  if (status === 422) return { kind: 'rejected', message }

  return { kind: 'failed', message }
}

export type ExecutionActionValues = {
  variantId?: unknown
  quantity?: unknown
  goodQuantity?: unknown
  scrapQuantity?: unknown
}

export type ActionFieldError = 'required' | 'invalidQuantity'

export type ActionPayloadResult =
  | { status: 'valid'; payload: RecordExecutionOperationInput }
  | { status: 'invalid'; fieldErrors: Partial<Record<keyof ExecutionActionValues, ActionFieldError>> }

function parseQuantity(value: unknown, locale?: string): number | null | 'missing' {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim().length === 0) return 'missing'

  return parseLocaleNumber(value.trim(), locale)
}

export function buildActionPayload(
  kind: ExecutionActionKind,
  executionId: string,
  operationId: string,
  values: ExecutionActionValues,
  locale?: string,
): ActionPayloadResult {
  if (kind === 'confirmProduction') {
    const goodQuantity = parseQuantity(values.goodQuantity ?? '0', locale)
    const scrapQuantity = parseQuantity(values.scrapQuantity ?? '0', locale)
    const fieldErrors: Partial<Record<keyof ExecutionActionValues, ActionFieldError>> = {}

    if (typeof goodQuantity !== 'number') fieldErrors.goodQuantity = goodQuantity === 'missing' ? 'required' : 'invalidQuantity'
    if (typeof scrapQuantity !== 'number') fieldErrors.scrapQuantity = scrapQuantity === 'missing' ? 'required' : 'invalidQuantity'

    if (typeof goodQuantity !== 'number' || typeof scrapQuantity !== 'number') return { status: 'invalid', fieldErrors }

    return { status: 'valid', payload: { action: kind, operationId, executionId, goodQuantity, scrapQuantity } }
  }

  const variantId = typeof values.variantId === 'string' && values.variantId ? values.variantId : null
  const quantity = parseQuantity(values.quantity, locale)
  const fieldErrors: Partial<Record<keyof ExecutionActionValues, ActionFieldError>> = {}

  if (!variantId) fieldErrors.variantId = 'required'
  if (typeof quantity !== 'number') fieldErrors.quantity = quantity === 'missing' ? 'required' : 'invalidQuantity'

  if (!variantId || typeof quantity !== 'number') return { status: 'invalid', fieldErrors }

  return { status: 'valid', payload: { action: kind, operationId, executionId, variantId, quantity } }
}

export type ExecutionSummary = {
  materials: MaterialVariance[]
  output: OutputVariance
}

export function summarizeExecution(documents: ExecutionDocumentListItem[], plannedQuantity: number | null): ExecutionSummary {
  const facts = documents.flatMap((document) => document.facts)

  return {
    materials: computeMaterialVariances([], facts),
    output: computeOutputVariance(plannedQuantity ?? 0, facts),
  }
}

export function newOperationId(): string {
  return globalThis.crypto.randomUUID()
}

export function postJson(path: string, body: unknown): Promise<ApiCallResult<unknown>> {
  return apiCall<unknown>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
