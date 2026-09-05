import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitManufacturingEvent, type ManufacturingEventId } from '../../events'

const logger = createLogger('manufacturing').child({ component: 'work-center-events' })

export type WorkCenterEventPayload = {
  id: string
  tenantId: string
  organizationId: string
  updatedAt: string
  membershipChanged?: boolean
  deletedAt?: string
}

/**
 * Post-commit emission for every Work Centre write, undo and redo.
 *
 * `id` is always the canonical Work Centre UUID. Emission runs after the
 * transaction commits and swallows its own failures: the mutation is already
 * durable, so turning a post-commit event failure into a failed API response
 * would only invite a duplicate retry. Payloads carry scoped identifiers only
 * — no resource, planner or snapshot data, and no undo token.
 */
export async function emitWorkCenterEvent(
  eventId: Extract<ManufacturingEventId, `manufacturing.work_center.${string}`>,
  payload: WorkCenterEventPayload,
): Promise<void> {
  try {
    await emitManufacturingEvent(eventId, payload)
  } catch (error) {
    logger.error('Work Centre event emission failed after commit', {
      eventId,
      workCenterId: payload.id,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
