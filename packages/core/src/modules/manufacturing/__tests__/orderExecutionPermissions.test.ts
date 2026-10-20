/** @jest-environment node */

import { executionPermissionsFor } from '../domain/orderExecutionPermissions'

describe('order execution permissions', () => {
  it.each([
    ['draft', false, true, false],
    ['released', true, true, true],
    ['in_progress', true, true, true],
    ['completed', true, true, true],
    ['cancelled', false, true, false],
  ] as const)('a %s order allows issue=%s, return=%s, confirmation=%s', (status, allowsIssue, allowsReturn, allowsConfirmation) => {
    expect(executionPermissionsFor(status)).toEqual({ allowsIssue, allowsReturn, allowsConfirmation })
  })
})
