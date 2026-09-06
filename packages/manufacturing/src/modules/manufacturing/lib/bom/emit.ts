import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitManufacturingEvent, type ManufacturingEventId } from '../../events'

const logger = createLogger('manufacturing')

export type BomEventPayload = {
  tenantId: string
  organizationId: string
  bomId: string
  revisionId: string
  revisionUpdatedAt: string
  lineId?: string
  adjacentLineId?: string | null
  changed?: boolean
}

/**
 * Post-commit event emission for every BOM write, undo and redo.
 *
 * Called after the graph-locked transaction has committed, never inside it:
 * an event announcing a write that then rolls back is worse than no event.
 * Emission failures are logged and swallowed for the same reason the spec
 * gives for guard callbacks — the mutation is already durable, so failing the
 * response would invite a duplicate retry. Payloads carry scoped identifiers
 * only: no Catalog labels, no quantity snapshot, no undo token.
 */
export async function emitBomEvent(eventId: ManufacturingEventId, payload: BomEventPayload): Promise<void> {
  try {
    await emitManufacturingEvent(eventId, payload)
  } catch (error) {
    logger.error('Manufacturing event emission failed after commit', {
      eventId,
      bomId: payload.bomId,
      revisionId: payload.revisionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
