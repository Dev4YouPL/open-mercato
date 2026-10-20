import {
  buildBomListSearchParams,
  parseBomListResponse,
  parseBomListStatusFilter,
} from '../bomListClient'

const baseInput = {
  page: 2,
  pageSize: 25,
  search: '',
  status: null,
  sorting: [],
}

const bomId = '33333333-3333-4333-8333-333333333333'
const outputVariantId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-10-08T13:00:00.000Z'

const listItem = {
  id: bomId,
  outputVariantId,
  baseQuantity: '1',
  revision: '1',
  status: 'released',
  isIncomplete: false,
  releasedAt: timestamp,
  releasedByUserId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  outputVariant: {
    id: outputVariantId,
    name: 'Finished product',
    sku: 'OUTPUT-01',
    isActive: true,
    isDeleted: false,
  },
  availability: {
    isAvailable: true,
    reason: null,
  },
}

function listPayload(items: unknown[]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  }
}

describe('buildBomListSearchParams', () => {
  it('always sends pagination', () => {
    expect(buildBomListSearchParams(baseInput).toString()).toBe(
      'page=2&pageSize=25',
    )
  })

  it('omits a blank search and trims a filled one', () => {
    expect(buildBomListSearchParams({
      ...baseInput,
      search: '   ',
    }).has('search')).toBe(false)

    expect(buildBomListSearchParams({
      ...baseInput,
      search: '  OUTPUT  ',
    }).get('search')).toBe('OUTPUT')
  })

  it('maps the incomplete filter to released incomplete revisions', () => {
    const params = buildBomListSearchParams({
      ...baseInput,
      status: 'incomplete',
    })

    expect(params.get('status')).toBe('released')
    expect(params.get('isIncomplete')).toBe('true')
  })

  it.each(['draft', 'released'] as const)(
    'passes the %s status directly',
    (status) => {
      const params = buildBomListSearchParams({ ...baseInput, status })

      expect(params.get('status')).toBe(status)
      expect(params.has('isIncomplete')).toBe(false)
    },
  )

  it('sorts only by allowed columns', () => {
    const sorted = buildBomListSearchParams({
      ...baseInput,
      sorting: [{ id: 'updatedAt', desc: true }],
    })

    expect(sorted.get('sortField')).toBe('updatedAt')
    expect(sorted.get('sortDir')).toBe('desc')

    const ignored = buildBomListSearchParams({
      ...baseInput,
      sorting: [{ id: 'outputVariant', desc: false }],
    })

    expect(ignored.has('sortField')).toBe(false)
    expect(ignored.has('sortDir')).toBe(false)
  })
})

describe('parseBomListStatusFilter', () => {
  it.each(['draft', 'released', 'incomplete'])(
    'accepts %s',
    (value) => {
      expect(parseBomListStatusFilter(value)).toBe(value)
    },
  )

  it.each([undefined, null, '', 'archived', 1])(
    'rejects %p',
    (value) => {
      expect(parseBomListStatusFilter(value)).toBeNull()
    },
  )
})

describe('parseBomListResponse', () => {
  it('parses decorated list items', () => {
    const parsed = parseBomListResponse(listPayload([listItem]))

    expect(parsed.success).toBe(true)
    expect(parsed.data?.items[0]?.outputVariant?.sku).toBe('OUTPUT-01')
  })

  it('accepts a missing output variant', () => {
    expect(parseBomListResponse(listPayload([{
      ...listItem,
      outputVariant: null,
      availability: { isAvailable: false, reason: 'variantMissing' },
    }])).success).toBe(true)
  })

  it('rejects items without availability', () => {
    const { availability: _availability, ...withoutAvailability } = listItem

    expect(
      parseBomListResponse(listPayload([withoutAvailability])).success,
    ).toBe(false)
  })
})
