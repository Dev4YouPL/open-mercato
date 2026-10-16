import {
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'

import { loadAllBomReleaseItems } from '../bomReleaseClient'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readItems = jest.mocked(readApiResultOrThrow)

const bomId = '33333333-3333-4333-8333-333333333333'
const anotherBomId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-10-08T13:00:00.000Z'
const errorMessage = 'Could not load items'

function createItem(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    bomId,
    updatedAt: timestamp,
  }
}

function createPage(
  items: ReturnType<typeof createItem>[],
  page = 1,
  total = items.length,
) {
  return {
    items,
    total,
    page,
    pageSize: 100,
    totalPages: Math.ceil(total / 100),
  }
}

beforeEach(() => {
  readItems.mockReset()
})

describe('loadAllBomReleaseItems', () => {
  it('returns an empty snapshot for an empty BOM', async () => {
    readItems.mockResolvedValue(createPage([]))

    await expect(
      loadAllBomReleaseItems(bomId, errorMessage),
    ).resolves.toEqual([])
  })

  it('loads all 101 items from two pages', async () => {
    const items = Array.from(
      { length: 101 },
      (_, index) => createItem(index + 1),
    )

    readItems
      .mockResolvedValueOnce(
        createPage(items.slice(0, 100), 1, 101),
      )
      .mockResolvedValueOnce(
        createPage(items.slice(100), 2, 101),
      )

    const result = await loadAllBomReleaseItems(
      bomId,
      errorMessage,
    )

    expect(result).toEqual(
      items.map(({ id, updatedAt }) => ({
        id,
        updatedAt,
      })),
    )

    expect(readItems).toHaveBeenCalledTimes(2)

    const secondUrl = new URL(
      String(readItems.mock.calls[1][0]),
      'http://localhost',
    )

    expect(secondUrl.searchParams.get('bomId')).toBe(bomId)
    expect(secondUrl.searchParams.get('page')).toBe('2')
    expect(secondUrl.searchParams.get('pageSize')).toBe('100')
  })

  it('rejects duplicate item IDs', async () => {
    const item = createItem(1)

    readItems.mockResolvedValue(createPage([item, item]))

    await expect(
      loadAllBomReleaseItems(bomId, errorMessage),
    ).rejects.toThrow()
  })

  it('rejects items belonging to another BOM', async () => {
    readItems.mockResolvedValue(createPage([{
      ...createItem(1),
      bomId: anotherBomId,
    }]))

    await expect(
      loadAllBomReleaseItems(bomId, errorMessage),
    ).rejects.toThrow()
  })

  it('rejects an invalid item timestamp', async () => {
    readItems.mockResolvedValue(createPage([{
      ...createItem(1),
      updatedAt: 'invalid',
    }]))

    await expect(
      loadAllBomReleaseItems(bomId, errorMessage),
    ).rejects.toThrow()
  })

  it('rejects a capped item count', async () => {
    readItems.mockResolvedValue({
      ...createPage([createItem(1)]),
      totalIsCapped: true,
    })

    await expect(
      loadAllBomReleaseItems(bomId, errorMessage),
    ).rejects.toThrow()
  })

  it('propagates a second-page failure without returning a partial snapshot', async () => {
    const error = new Error('[internal] Page unavailable')

    readItems
      .mockResolvedValueOnce(createPage(
        Array.from(
          { length: 100 },
          (_, index) => createItem(index + 1),
        ),
        1,
        101,
      ))
      .mockRejectedValueOnce(error)

    await expect(
      loadAllBomReleaseItems(bomId, errorMessage),
    ).rejects.toBe(error)
  })
})