import { resolveBomAvailability } from '../bomAvailability'

const activeVariant = {
  isActive: true,
  isDeleted: false,
}

describe('resolveBomAvailability', () => {
  it('marks draft revisions as unavailable', () => {
    expect(resolveBomAvailability(
      { status: 'draft' },
      activeVariant,
    )).toEqual({ isAvailable: false, reason: 'draft' })
  })

  it('reports a missing output variant', () => {
    expect(resolveBomAvailability(
      { status: 'released' },
      null,
    )).toEqual({ isAvailable: false, reason: 'variantMissing' })
  })

  it('treats a deleted output variant as missing', () => {
    expect(resolveBomAvailability(
      { status: 'released' },
      { isActive: true, isDeleted: true },
    )).toEqual({ isAvailable: false, reason: 'variantMissing' })
  })

  it('reports an inactive output variant', () => {
    expect(resolveBomAvailability(
      { status: 'released' },
      { isActive: false, isDeleted: false },
    )).toEqual({ isAvailable: false, reason: 'variantInactive' })
  })

  it('marks a released revision with an active variant as available', () => {
    expect(resolveBomAvailability(
      { status: 'released' },
      activeVariant,
    )).toEqual({ isAvailable: true, reason: null })
  })

  it('keeps an incomplete released revision available', () => {
    const incompleteBom = {
      status: 'released' as const,
      isIncomplete: true,
    }

    expect(resolveBomAvailability(
      incompleteBom,
      activeVariant,
    )).toEqual({ isAvailable: true, reason: null })
  })
})
