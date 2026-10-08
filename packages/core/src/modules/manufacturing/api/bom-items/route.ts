import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'

import { E } from '#generated/entities.ids.generated'

import {
  makeCrudRoute,
} from '@open-mercato/shared/lib/crud/factory'
import {
  resolveTranslations,
} from '@open-mercato/shared/lib/i18n/server'

import { ManufacturingBomItem } from '../../data/entities'

import {
  bomItemCreateSchema,
  bomItemListQuerySchema,
  bomItemUpdateSchema,
} from '../../data/validators'

import type {
  BomItemCreateInput,
  BomItemUpdateInput,
} from '../../data/validators'

import {
  requireScopedBom,
} from '../../lib/bomValidation'

import {
  bomItemOpenApi,
  bomItemResponseSchema,
} from '../openapi'

import {
  manufacturingDeleteRequestSchema,
  mapBomItemCreateInput,
  mapBomItemDeleteInput,
  mapBomItemUpdateInput,
  resolveManufacturingApiScope,
} from '../utils'

type BomItemListQuery =
  z.infer<typeof bomItemListQuerySchema>

const bomItemEntityId =
  E.manufacturing.manufacturing_bom_item

const recordSchema = z.record(z.string(), z.unknown())

const bomItemCommandResultSchema = z.object({
  bomItemId: z.string().uuid(),
})

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['manufacturing.view'],
  },
  POST: {
    requireAuth: true,
    requireFeatures: ['manufacturing.manage'],
  },
  PUT: {
    requireAuth: true,
    requireFeatures: ['manufacturing.manage'],
  },
  DELETE: {
    requireAuth: true,
    requireFeatures: ['manufacturing.manage'],
  },
}

function serializeTimestamp(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)

    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toISOString()
  }

  return value
}

function transformBomItemResponse(item: unknown) {
  const record = recordSchema.parse(item)

  return bomItemResponseSchema.parse({
    id: record.id,
    bomId: record.bom_id ?? record.bomId,
    componentVariantId:
      record.component_variant_id ??
      record.componentVariantId,
    quantity: record.quantity,
    position: record.position,
    createdAt: serializeTimestamp(
      record.created_at ?? record.createdAt,
    ),
    updatedAt: serializeTimestamp(
      record.updated_at ?? record.updatedAt,
    ),
  })
}

const crud = makeCrudRoute<
  BomItemCreateInput,
  BomItemUpdateInput,
  BomItemListQuery
>({
  metadata,

  orm: {
    entity: ManufacturingBomItem,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },

  events: {
    module: 'manufacturing',
    entity: 'bom_item',
    persistent: true,
  },

  indexer: {
    entityType: bomItemEntityId,
  },

  list: {
    schema: bomItemListQuerySchema,
    entityId: bomItemEntityId,

    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'bom_id',
      'component_variant_id',
      'quantity',
      'position',
      'created_at',
      'updated_at',
    ],

    sortFieldMap: {
      id: 'id',
      position: 'position',
      componentVariantId: 'component_variant_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },

    defaultSort: {
      field: 'position',
      dir: 'asc',
    },

    tiebreakSortField: 'id',

    buildFilters: async (query, ctx) => {
      const scope = await resolveManufacturingApiScope(ctx)

      const filters: Record<string, unknown> = {
        tenant_id: { $eq: scope.tenantId },
        organization_id: { $eq: scope.organizationId },
        bom_id: { $eq: query.bomId },
        deleted_at: { $eq: null },
      }

      if (query.id) {
        filters.id = { $eq: query.id }
      }

      return filters
    },

    transformItem: transformBomItemResponse,
  },

  actions: {
    create: {
      commandId: 'manufacturing.bom_items.create',
      schema: bomItemCreateSchema,
      mapInput: mapBomItemCreateInput,

      response: ({ result }: { result: unknown }) => {
        const parsed =
          bomItemCommandResultSchema.parse(result)

        return {
          id: parsed.bomItemId,
        }
      },

      status: 201,
    },

    update: {
      commandId: 'manufacturing.bom_items.update',
      schema: bomItemUpdateSchema,
      mapInput: mapBomItemUpdateInput,

      response: () => ({
        ok: true,
      }),
    },

    delete: {
      commandId: 'manufacturing.bom_items.delete',
      schema: manufacturingDeleteRequestSchema,
      mapInput: mapBomItemDeleteInput,

      response: () => ({
        ok: true,
      }),
    },
  },

  hooks: {
    beforeList: async (query, ctx) => {
      const scope = await resolveManufacturingApiScope(ctx)
      const { translate } = await resolveTranslations()

      const em = ctx.container
        .resolve<EntityManager>('em')
        .fork()

      await requireScopedBom(
        em,
        query.bomId,
        scope,
        translate('manufacturing.errors.bomUnavailable'),
      )
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = bomItemOpenApi