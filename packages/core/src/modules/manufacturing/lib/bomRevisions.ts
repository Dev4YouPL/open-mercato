import type { EntityManager } from '@mikro-orm/postgresql'

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { ManufacturingBom } from '../data/entities'
import type { BomScope } from './bomValidation'

export async function resolveNextBomRevision(
  em: EntityManager,
  outputVariantId: string,
  scope: BomScope,
): Promise<string> {
  const boms = await findWithDecryption(
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

  let maximumRevision = BigInt(0)

  for (const bom of boms) {
    if (!/^[1-9]\d*$/.test(bom.revision)) {
      throw new Error('[internal] Invalid manufacturing BOM revision')
    }

    const revision = BigInt(bom.revision)

    if (revision > maximumRevision) {
      maximumRevision = revision
    }
  }

  return (maximumRevision + BigInt(1)).toString()
}