/** @jest-environment node */

import { isTrackingSupported } from '../domain/trackingSupport'

describe('isTrackingSupported', () => {
  it('supports variants without any tracking', () => {
    expect(isTrackingSupported({ tracksLot: false, tracksSerial: false, tracksExpiry: false })).toBe(true)
  })

  it.each([
    ['lot', { tracksLot: true, tracksSerial: false, tracksExpiry: false }],
    ['serial number', { tracksLot: false, tracksSerial: true, tracksExpiry: false }],
    ['expiry date', { tracksLot: false, tracksSerial: false, tracksExpiry: true }],
  ])('does not support variants tracked by %s', (_label, requirements) => {
    expect(isTrackingSupported(requirements)).toBe(false)
  })
})
