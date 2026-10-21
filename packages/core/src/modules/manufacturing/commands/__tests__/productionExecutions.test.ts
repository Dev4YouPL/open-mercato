/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { toExecutionOperationResult } from '../productionExecutions'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const translate = (_key: string, fallback?: string) => fallback ?? _key

function errorOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return null
}

describe('execution operation result mapping', () => {
  it('returns an accepted operation with its id and WMS movement', () => {
    expect(toExecutionOperationResult({ status: 'accepted', movementId: 'movement-1' }, 'operation-1', translate)).toEqual({
      status: 'accepted',
      operationId: 'operation-1',
      movementId: 'movement-1',
    })
  })

  it('maps a known rejection to 422 with its code', () => {
    const error = errorOf(() =>
      toExecutionOperationResult({ status: 'rejected', code: 'insufficient_stock', message: 'Not enough stock.' }, 'operation-1', translate),
    )

    expect(error).toBeInstanceOf(CrudHttpError)
    expect(error).toMatchObject({ status: 422, body: { code: 'insufficient_stock', error: 'Not enough stock.' } })
  })

  it('maps a blocked operation to 409 with the operation to retry first', () => {
    const error = errorOf(() =>
      toExecutionOperationResult({ status: 'blocked', blockingOperationId: 'operation-0' }, 'operation-1', translate),
    )

    expect(error).toMatchObject({ status: 409, body: { code: 'operation_blocked', blockingOperationId: 'operation-0' } })
  })

  it('maps an unknown outcome to a retryable 503 carrying the same operation id', () => {
    const error = errorOf(() => toExecutionOperationResult({ status: 'unknown', cause: new Error('timeout') }, 'operation-1', translate))

    expect(error).toMatchObject({ status: 503, body: { code: 'operation_outcome_unknown', operationId: 'operation-1' } })
  })
})
