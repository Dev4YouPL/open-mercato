import type { EntityManager } from '@mikro-orm/postgresql'

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { ManufacturingBom } from '../../data/entities'
import { resolveNextBomRevision } from '../bomRevisions'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const findBoms = jest.mocked(findWithDecryption)

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const outputVariantId = '33333333-3333-4333-8333-333333333333'
const em = {} as EntityManager

function createBom(
  revision: string,
  deletedAt: Date | null = null,
): ManufacturingBom {
  const bom = new ManufacturingBom()

  bom.revision = revision
  bom.deletedAt = deletedAt

  return bom
}

describe('resolveNextBomRevision', () => {
  beforeEach(() => {
    findBoms.mockReset()
  })

  it('returns 1 when the variant has no BOMs', async () => {
    findBoms.mockResolvedValue([])

    await expect(
      resolveNextBomRevision(em, outputVariantId, scope),
    ).resolves.toBe('1')
  })

  it('compares revisions numerically and preserves gaps', async () => {
    findBoms.mockResolvedValue([
      createBom('9'),
      createBom('2'),
      createBom('10'),
    ])

    await expect(
      resolveNextBomRevision(em, outputVariantId, scope),
    ).resolves.toBe('11')
  })

  it('includes soft-deleted BOMs and scopes the query', async () => {
    findBoms.mockResolvedValue([
      createBom('1'),
      createBom('3', new Date('2026-10-08T13:00:00Z')),
    ])

    await expect(
      resolveNextBomRevision(em, outputVariantId, scope),
    ).resolves.toBe('4')

    expect(findBoms).toHaveBeenCalledWith(
      em,
      ManufacturingBom,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        outputVariantId,
      },
      {
        fields: ['revision'],
        refresh: true,
      },
      scope,
    )
  })

  it('handles revisions larger than the safe integer range', async () => {
    findBoms.mockResolvedValue([
      createBom('9007199254740993'),
    ])

    await expect(
      resolveNextBomRevision(em, outputVariantId, scope),
    ).resolves.toBe('9007199254740994')
  })

  it('rejects invalid stored revisions', async () => {
    findBoms.mockResolvedValue([
      createBom('invalid'),
    ])

    await expect(
      resolveNextBomRevision(em, outputVariantId, scope),
    ).rejects.toThrow(
      '[internal] Invalid manufacturing BOM revision',
    )
  })

  it('propagates database read failures', async () => {
    const error = new Error('[internal] Database unavailable')

    findBoms.mockRejectedValue(error)

    await expect(
      resolveNextBomRevision(em, outputVariantId, scope),
    ).rejects.toBe(error)
  })
})