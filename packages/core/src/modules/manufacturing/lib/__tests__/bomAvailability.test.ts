import { resolveBomAvailability } from '../bomAvailability'

const activeVariant = {
  isActive: true,
  isDeleted: false,
}

describe('resolveBomAvailability', () => {
  it('marks draft revisions as unavailable', () => {
    expect(resolveBomAvailability(
      { status: 'draft', isAvailableForNewOrders: true },
      activeVariant,
    )).toEqual({ isAvailable: false, reason: 'draft' })
  })

  it('reports a missing output variant', () => {
    expect(resolveBomAvailability(
      { status: 'released', isAvailableForNewOrders: true },
      null,
    )).toEqual({ isAvailable: false, reason: 'variantMissing' })
  })

  it('treats a deleted output variant as missing', () => {
    expect(resolveBomAvailability(
      { status: 'released', isAvailableForNewOrders: true },
      { isActive: true, isDeleted: true },
    )).toEqual({ isAvailable: false, reason: 'variantMissing' })
  })

  it('reports an inactive output variant', () => {
    expect(resolveBomAvailability(
      { status: 'released', isAvailableForNewOrders: true },
      { isActive: false, isDeleted: false },
    )).toEqual({ isAvailable: false, reason: 'variantInactive' })
  })

  it('marks a released revision with an active variant as available', () => {
    expect(resolveBomAvailability(
      { status: 'released', isAvailableForNewOrders: true },
      activeVariant,
    )).toEqual({ isAvailable: true, reason: null })
  })

  it('keeps an incomplete released revision available', () => {
    const incompleteBom = {
      status: 'released' as const,
      isAvailableForNewOrders: true,
      isIncomplete: true,
    }

    expect(resolveBomAvailability(
      incompleteBom,
      activeVariant,
    )).toEqual({ isAvailable: true, reason: null })
  })

  it('reports withdrawn revisions before checking the output variant', () => {
    expect(resolveBomAvailability(
      { status: 'released', isAvailableForNewOrders: false },
      null,
    )).toEqual({ isAvailable: false, reason: 'withdrawn' })
  })
})
