import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'

import type {
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import {
  forbidden,
  notFound,
} from '@open-mercato/shared/lib/crud/errors'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'

import {
  ManufacturingBom,
  ManufacturingBomItem,
} from '../data/entities'
import { assertBomIsDraft } from './bomValidation'
import type { BomScope } from './bomValidation'

type Translate = (key: string) => string

export function resolveBomCommandScope(
  ctx: CommandRuntimeContext,
  errorMessage: string,
): BomScope {
  const tenantId = ctx.auth?.tenantId
  const organizationId =
    ctx.selectedOrganizationId ?? ctx.auth?.orgId

  if (!tenantId || !organizationId) {
    throw forbidden(errorMessage)
  }

  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)

  return {
    tenantId,
    organizationId,
  }
}

export async function requireLockedBom(
  em: EntityManager,
  bomId: string,
  scope: BomScope,
  translate: Translate,
): Promise<ManufacturingBom> {
  const bom = await findOneWithDecryption(
    em,
    ManufacturingBom,
    {
      id: bomId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      refresh: true,
    },
    scope,
  )

  if (!bom) {
    throw notFound(
      translate('manufacturing.errors.bomUnavailable'),
    )
  }

  return bom
}

export async function requireLockedDraftBom(
  em: EntityManager,
  bomId: string,
  scope: BomScope,
  translate: Translate,
): Promise<ManufacturingBom> {
  const bom = await requireLockedBom(em, bomId, scope, translate)
  assertBomIsDraft(bom, translate('manufacturing.errors.bomNotDraft'))
  return bom
}

export async function requireScopedBomItem(
  em: EntityManager,
  itemId: string,
  bomId: string,
  scope: BomScope,
  errorMessage: string,
): Promise<ManufacturingBomItem> {
  const item = await findOneWithDecryption(
    em,
    ManufacturingBomItem,
    {
      id: itemId,
      bom: bomId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {
      refresh: true,
    },
    scope,
  )

  if (!item) {
    throw notFound(errorMessage)
  }

  return item
}

export async function loadActiveBomItems(
  em: EntityManager,
  bomId: string,
  scope: BomScope,
): Promise<ManufacturingBomItem[]> {
  return findWithDecryption(
    em,
    ManufacturingBomItem,
    {
      bom: bomId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {
      orderBy: {
        position: 'asc',
        id: 'asc',
      },
    },
    scope,
  )
}
