import { z } from 'zod'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { decimalStringSchema, unitCodeSchema } from '../data/validators'

/**
 * Response and header schemas for the ten BOM endpoints.
 *
 * The spec requires the published document to describe request/response
 * bodies, decimal strings, cursor opacity, the warning model and the
 * expected-version header rather than prose-only status descriptions. Response
 * headers (`x-om-operation`) still cannot be expressed by the shared route
 * type, so they stay asserted by tests instead.
 */

export const expectedVersionHeaderSchema = z.object({
  [OPTIMISTIC_LOCK_HEADER_NAME]: z
    .string()
    .optional()
    .describe('ISO-8601 `updatedAt` of the draft revision the caller last read. Omitting it skips the check.'),
})

export const opaqueCursorSchema = z
  .string()
  .max(512)
  .describe('Opaque keyset cursor. Treat as a token: it encodes scope, page size and filters and is rejected elsewhere.')

const isoTimestampSchema = z.string().describe('ISO-8601 timestamp.')

const quantityScalarSchema = decimalStringSchema.describe(
  'Canonical base-10 decimal string. Never a JSON number — binary floats cannot represent these exactly.',
)

export const bomTargetSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
})

export const bomTargetLabelSchema = z.object({
  productName: z.string().nullable(),
  variantName: z.string().nullable(),
  catalogState: z.enum(['resolved', 'partial', 'missing']),
})

export const directLineSummarySchema = z.object({
  count: z.number().int(),
  unresolvedProduceCount: z
    .number()
    .int()
    .describe('`produce` occurrences whose component resolves to no live child BOM. A warning counter, not a total.'),
})

const baseOutputSchema = z.object({
  value: quantityScalarSchema,
  unitCode: unitCodeSchema,
  normalizedValue: quantityScalarSchema,
  baseUnitCode: unitCodeSchema,
})

export const activeDraftSummarySchema = z.object({
  id: z.string().uuid(),
  revisionNumber: z.number().int(),
  revisionLabel: z.string().nullable(),
  updatedAt: isoTimestampSchema.describe('Optimistic-lock token for every write against this draft.'),
})

export const bomListItemSchema = z.object({
  id: z.string().uuid(),
  target: bomTargetSchema,
  targetLabel: bomTargetLabelSchema,
  activeDraft: activeDraftSummarySchema,
  directLineSummary: directLineSummarySchema,
  updatedAt: isoTimestampSchema,
})

export const bomListResponseSchema = z.object({
  items: z.array(bomListItemSchema),
  nextCursor: opaqueCursorSchema.nullable(),
  hasMore: z.boolean(),
})

export const bomDetailSchema = z.object({
  id: z.string().uuid(),
  customFields: z.record(z.string(), z.unknown()),
  target: bomTargetSchema,
  targetLabel: bomTargetLabelSchema,
  activeDraft: activeDraftSummarySchema.extend({ baseOutput: baseOutputSchema }),
  directLineSummary: directLineSummarySchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

export const bomMutationResultSchema = z.object({
  bom: bomDetailSchema,
  updatedAt: isoTimestampSchema.describe('The draft revision token to send with the next write.'),
})

export const bomDeleteResultSchema = z.object({
  id: z.string().uuid(),
  deletedAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

export const bomLineResolutionSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('stock_leaf') }),
  z.object({
    state: z.literal('unresolved'),
    warning: z.object({ code: z.literal('bom.child_unresolved'), lineId: z.string().uuid() }),
  }),
  z.object({
    state: z.enum(['variant', 'product_fallback']),
    childBomId: z.string().uuid(),
    childRevisionId: z.string().uuid(),
  }),
])

export const bomLineSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  componentProductId: z.string().uuid(),
  componentVariantId: z.string().uuid().nullable(),
  componentLabel: bomTargetLabelSchema,
  quantity: z.object({
    value: quantityScalarSchema,
    unitCode: unitCodeSchema,
    normalizedValue: quantityScalarSchema,
    baseUnitCode: unitCodeSchema,
  }),
  consumptionBasis: z.enum(['variable', 'fixed']),
  yieldFactor: quantityScalarSchema.describe('Decimal string in the half-open range (0, 1].'),
  supplyMode: z.enum(['stock', 'produce']),
  resolution: bomLineResolutionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

export const bomLineListResponseSchema = z.object({
  items: z.array(bomLineSchema),
  nextCursor: opaqueCursorSchema.nullable(),
  hasMore: z.boolean(),
  snapshotUpdatedAt: isoTimestampSchema.describe('Draft revision token the returned page was read at.'),
})

export const bomLineMutationResultSchema = z.object({
  line: bomLineSchema,
  updatedAt: isoTimestampSchema,
})

export const bomLineDeleteResultSchema = z.object({
  lineId: z.string().uuid(),
  deletedAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

export const bomLineReorderResultSchema = z.object({
  line: z.object({ id: z.string().uuid(), position: z.number().int() }),
  adjacentLine: z.object({ id: z.string().uuid(), position: z.number().int() }).nullable(),
  updatedAt: isoTimestampSchema,
  changed: z.boolean().describe('False at a list boundary: no swap happened and no undoable action was recorded.'),
})

export const validationErrorSchema = z.object({
  error: z.literal('validation_error'),
  issues: z.array(z.unknown()).optional(),
})

export const bomDomainErrorSchema = z.object({
  error: z.string().describe('Stable domain code, for example `bom.target_conflict` or `bom.cycle_detected`.'),
  code: z.string(),
})

/**
 * `GET /api/manufacturing/boms` answers 400 with either shape: a zod failure
 * on the query, or the domain error a rejected cursor raises. Documenting only
 * one of them would leave a generated client unable to parse the other.
 */
export const listBadRequestSchema = z.union([validationErrorSchema, bomDomainErrorSchema])

export const optimisticLockConflictSchema = z.object({
  error: z.literal(OPTIMISTIC_LOCK_CONFLICT_ERROR),
  code: z.literal(OPTIMISTIC_LOCK_CONFLICT_CODE),
  currentUpdatedAt: isoTimestampSchema,
  expectedUpdatedAt: isoTimestampSchema,
})
