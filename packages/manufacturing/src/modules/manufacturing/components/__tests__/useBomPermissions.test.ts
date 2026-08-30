const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

const MANAGE = 'manufacturing.bom.manage'

/**
 * The list and editor pages only require `manufacturing.bom.view`, so a viewer
 * can open them. Write affordances must be hidden rather than offered and
 * rejected (spec ACL / US-BOM-31), and the decision must fail closed.
 *
 * `useBomPermissions` is a React hook; these cases pin the grant decision it
 * delegates to, including the platform wildcard forms an ACL grant can take.
 */
describe('BOM manage-feature gating', () => {
  it('grants manage on an exact feature match', () => {
    expect(hasAllFeatures([MANAGE], ['manufacturing.bom.view', MANAGE])).toBe(true)
  })

  it('denies manage when only view is granted', () => {
    expect(hasAllFeatures([MANAGE], ['manufacturing.bom.view'])).toBe(false)
  })

  it('denies manage for an empty grant set, so the UI fails closed', () => {
    expect(hasAllFeatures([MANAGE], [])).toBe(false)
  })

  it('honours wildcard grants rather than requiring a literal string', () => {
    expect(hasAllFeatures([MANAGE], ['manufacturing.bom.*'])).toBe(true)
    expect(hasAllFeatures([MANAGE], ['manufacturing.*'])).toBe(true)
    expect(hasAllFeatures([MANAGE], ['*'])).toBe(true)
  })

  it('does not let an unrelated module wildcard grant BOM management', () => {
    expect(hasAllFeatures([MANAGE], ['catalog.*'])).toBe(false)
    expect(hasAllFeatures([MANAGE], ['manufacturing.routing.*'])).toBe(false)
  })
})
