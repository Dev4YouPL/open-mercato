import { z } from 'zod'

import { E } from '#generated/entities.ids.generated'

import {
  makeCrudRoute,
} from '@open-mercato/shared/lib/crud/factory'

import { ManufacturingBom } from '../../data/entities'

import {
  bomCreateSchema,
  bomListQuerySchema,
  bomUpdateSchema,
} from '../../data/validators'

import type {
  BomCreateInput,
  BomUpdateInput,
} from '../../data/validators'

import {
  bomOpenApi,
  bomResponseSchema,
} from '../openapi'

import {
  manufacturingDeleteRequestSchema,
  mapBomCreateInput,
  mapBomDeleteInput,
  mapBomUpdateInput,
  resolveManufacturingApiScope,
} from '../utils'

type BomListQuery = z.infer<typeof bomListQuerySchema>

const bomEntityId = E.manufacturing.manufacturing_bom

const recordSchema = z.record(z.string(), z.unknown())

const bomCommandResultSchema = z.object({
  bomId: z.string().uuid(),
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
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  return value
}

function transformBomResponse(item: unknown) {
  const record = recordSchema.parse(item)

  return bomResponseSchema.parse({
    id: record.id,
    outputVariantId:
      record.output_variant_id ?? record.outputVariantId,
    baseQuantity:
      record.base_quantity ?? record.baseQuantity,
    revision: record.revision,
    status: record.status,
    isIncomplete:
      record.is_incomplete ?? record.isIncomplete,
    releasedAt: serializeTimestamp(
      record.released_at ?? record.releasedAt ?? null,
    ),
    releasedByUserId:
      record.released_by_user_id ??
      record.releasedByUserId ??
      null,
    createdAt: serializeTimestamp(
      record.created_at ?? record.createdAt,
    ),
    updatedAt: serializeTimestamp(
      record.updated_at ?? record.updatedAt,
    ),
  })
}

const crud = makeCrudRoute<
  BomCreateInput,
  BomUpdateInput,
  BomListQuery
>({
  metadata,

  orm: {
    entity: ManufacturingBom,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },

  events: {
    module: 'manufacturing',
    entity: 'bom',
    persistent: true,
  },

  indexer: {
    entityType: bomEntityId,
  },

  list: {
    schema: bomListQuerySchema,
    entityId: bomEntityId,

    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'output_variant_id',
      'base_quantity',
      'revision',
      'status',
      'is_incomplete',
      'released_at',
      'released_by_user_id',
      'created_at',
      'updated_at',
    ],

    sortFieldMap: {
      id: 'id',
      outputVariantId: 'output_variant_id',
      revision: 'revision',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },

    defaultSort: {
      field: 'createdAt',
      dir: 'desc',
    },

    tiebreakSortField: 'id',

    buildFilters: async (query, ctx) => {
      const scope = await resolveManufacturingApiScope(ctx)

      const filters: Record<string, unknown> = {
        tenant_id: { $eq: scope.tenantId },
        organization_id: { $eq: scope.organizationId },
        deleted_at: { $eq: null },
      }

      if (query.id) {
        filters.id = { $eq: query.id }
      }

      if (query.outputVariantId) {
        filters.output_variant_id = {
          $eq: query.outputVariantId,
        }
      }

      if (query.status) {
        filters.status = { $eq: query.status }
      }

      if (query.isIncomplete !== undefined) {
        filters.is_incomplete = {
          $eq: query.isIncomplete,
        }
      }

      return filters
    },

    transformItem: transformBomResponse,
  },

  actions: {
    create: {
      commandId: 'manufacturing.boms.create',
      schema: bomCreateSchema,
      mapInput: mapBomCreateInput,

      response: ({ result }: { result: unknown }) => {
        const parsed = bomCommandResultSchema.parse(result)

        return {
          id: parsed.bomId,
        }
      },

      status: 201,
    },

    update: {
      commandId: 'manufacturing.boms.update',
      schema: bomUpdateSchema,
      mapInput: mapBomUpdateInput,

      response: () => ({
        ok: true,
      }),
    },

    delete: {
      commandId: 'manufacturing.boms.delete',
      schema: manufacturingDeleteRequestSchema,
      mapInput: mapBomDeleteInput,

      response: () => ({
        ok: true,
      }),
    },
  },

  hooks: {
    beforeList: async (_query, ctx) => {
      await resolveManufacturingApiScope(ctx)
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = bomOpenApi