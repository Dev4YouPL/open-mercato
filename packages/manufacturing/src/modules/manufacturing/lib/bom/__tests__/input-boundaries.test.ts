import { bomQuantitySchema, bomYieldFactorSchema } from '../../../data/validators'
import { decodeBomCursor, decodeLineCursor } from '../cursor'
import { BomDomainError, BomOptimisticLockConflictError } from '../errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const identity = '11111111-1111-4111-8111-111111111111'
const timestamp = '2026-09-05T12:00:00.000Z'
const encode = (payload: Record<string, unknown>) => Buffer.from(JSON.stringify(payload)).toString('base64url')
const scope = { v: 1, id: identity, tenantId: identity, organizationId: identity, pageSize: 50 }

describe('BOM database input boundaries', () => {
  it.each(['0', '0.0', '00', '000.000', '-1', '1000000000000', '0.0000001'])(
    'rejects nonpositive or unrepresentable quantity %s', (value) => {
      expect(bomQuantitySchema.safeParse(value).success).toBe(false)
    },
  )
  it.each(['1', '0001.0000000', '999999999999.999999', '0.000001'])(
    'accepts exactly representable quantity %s', (value) => {
      expect(bomQuantitySchema.safeParse(value).success).toBe(true)
    },
  )
  it('enforces yield precision and its upper bound', () => {
    expect(bomYieldFactorSchema.safeParse('0.000000000001').success).toBe(true)
    for (const value of ['0.0000000000001', '1.000000000001', '0.00']) {
      expect(bomYieldFactorSchema.safeParse(value).success).toBe(false)
    }
  })
  it('rejects invalid timestamps before they reach SQL', () => {
    expect(decodeBomCursor(encode({ ...scope, updatedAt: 'yesterday', filterDigest: '' }))).toBeNull()
    expect(decodeLineCursor(encode({ ...scope, bomId: identity, revisionId: identity, revisionUpdatedAt: 'invalid', position: '1' }))).toBeNull()
    expect(decodeBomCursor(encode({ ...scope, updatedAt: timestamp, filterDigest: '' }))).not.toBeNull()
  })
  it.each(['abc', '1.5', '-1', '9223372036854775808'])(
    'rejects invalid bigint cursor %s', (position) => {
      expect(decodeLineCursor(encode({ ...scope, bomId: identity, revisionId: identity, revisionUpdatedAt: timestamp, position }))).toBeNull()
    },
  )
  it('preserves domain and optimistic conflict HTTP payloads for audit endpoints', () => {
    const domain = new BomDomainError('bom.version_conflict', { field: 'revision' })
    expect(isCrudHttpError(domain)).toBe(true)
    expect(domain.status).toBe(409)
    expect(domain.body).toEqual({ error: 'bom.version_conflict', code: 'bom.version_conflict', field: 'revision' })
    const conflict = new BomOptimisticLockConflictError(timestamp, 'older')
    expect(isCrudHttpError(conflict)).toBe(true)
    expect(conflict.body.code).toBe('optimistic_lock_conflict')
  })
})
