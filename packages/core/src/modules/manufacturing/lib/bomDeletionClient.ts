import { z } from 'zod'
import type { BomDeletionBlockReason } from '../domain/bomDeletion'

const usageSchema = z.object({ bomId: z.string().uuid(), revision: z.string(), sourceKind: z.string(), sourceNumber: z.string().nullable() })
const decisionSchema = z.object({ allowed: z.boolean(), reason: z.string().nullable(), totalUsages: z.number().int(), usages: z.array(usageSchema) })
export const bomDeletionPreviewSchema = z.object({
  outputVariant: z.object({ id: z.string().uuid(), name: z.string().nullable(), sku: z.string().nullable() }).nullable(),
  revision: z.object({ id: z.string().uuid(), revision: z.string(), status: z.enum(['draft', 'released']), updatedAt: z.string().datetime(), itemCount: z.number().int() }),
  revisions: z.array(z.object({ id: z.string().uuid(), revision: z.string(), status: z.enum(['draft', 'released']), updatedAt: z.string().datetime(), itemCount: z.number().int() })),
  revisionVersion: z.string().regex(/^v1:[0-9a-f]{64}$/), bomVersion: z.string().regex(/^v1:[0-9a-f]{64}$/),
  revisionDeletion: decisionSchema, bomDeletion: decisionSchema,
})
export type BomDeletionPreview = z.infer<typeof bomDeletionPreviewSchema>
export type ReportedBomUsage = z.infer<typeof usageSchema>
export type BomDeletionFailure =
  | { kind: 'blocked'; reason: BomDeletionBlockReason; totalUsages: number; usages: ReportedBomUsage[] }
  | { kind: 'stale' }
  | { kind: 'other' }

export function parseBomDeletionError(error: unknown): BomDeletionFailure {
  if (typeof error !== 'object' || error === null) return { kind: 'other' }
  const record = error as Record<string, unknown>
  const body = typeof record.body === 'object' && record.body !== null ? record.body as Record<string, unknown> : record
  if (body.code === 'manufacturing.bom_delete.stale') return { kind: 'stale' }
  if ((body.code === 'manufacturing.bom_delete.revision_used' || body.code === 'manufacturing.bom_delete.bom_used') && Array.isArray(body.usages)) {
    const usages = z.array(usageSchema).safeParse(body.usages)
    if (usages.success) return { kind: 'blocked', reason: body.code.endsWith('revision_used') ? 'revision_used' : 'bom_used', totalUsages: typeof body.totalUsages === 'number' ? body.totalUsages : usages.data.length, usages: usages.data }
  }
  return { kind: 'other' }
}
