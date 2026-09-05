import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { emitBomEvent } from '../emit'

/**
 * The seven events declared in `events.ts` were never emitted:
 * `emitManufacturingEvent` had exactly one occurrence in the repository — its
 * own definition — so workflows, the SSE bridge and UI refresh saw nothing.
 *
 * Emission runs after commit, so a failure must never be reported to the
 * caller: the write is already durable and failing the response would invite a
 * duplicate retry (spec "Commands, Events, Undo, and Redo").
 */

const PAYLOAD = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  bomId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  revisionId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  revisionUpdatedAt: '2026-09-01T10:00:00.000Z',
}

afterEach(() => {
  setGlobalEventBus(null as never)
})

describe('emitBomEvent', () => {
  it('emits the declared event with scoped identifiers only', async () => {
    const emit = jest.fn(async () => {})
    setGlobalEventBus({ emit } as never)

    await emitBomEvent('manufacturing.bom_line.created', { ...PAYLOAD, lineId: 'cccccccc-3333-4333-8333-cccccccccccc' })

    expect(emit).toHaveBeenCalledTimes(1)
    const [eventId, payload] = emit.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(eventId).toBe('manufacturing.bom_line.created')
    expect(payload).toMatchObject({ ...PAYLOAD, lineId: 'cccccccc-3333-4333-8333-cccccccccccc' })
    expect(Object.keys(payload)).not.toContain('undoToken')
    expect(Object.keys(payload)).not.toContain('uomSnapshot')
  })

  it('swallows a bus failure so a committed write is still reported as successful', async () => {
    setGlobalEventBus({
      emit: async () => {
        throw new Error('[internal] bus unavailable')
      },
    } as never)

    await expect(emitBomEvent('manufacturing.bom.deleted', PAYLOAD)).resolves.toBeUndefined()
  })

  it('is a no-op when no event bus is installed', async () => {
    await expect(emitBomEvent('manufacturing.bom.created', PAYLOAD)).resolves.toBeUndefined()
  })
})
