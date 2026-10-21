import { z } from 'zod'

import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema,
} from '@open-mercato/shared/lib/openapi/crud'

import { bomStatusSchema } from '../data/bomStatus'
import { bomAvailabilitySchema } from '../lib/bomAvailability'

import {
  bomCreateSchema,
  bomDeleteSchema,
  bomItemCreateSchema,
  bomItemDeleteSchema,
  bomItemListQuerySchema,
  bomItemUpdateSchema,
  bomListQuerySchema,
  bomUpdateSchema,
} from '../data/validators'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })

export const bomResponseSchema = z.object({
  ...bomCreateSchema.shape,
  id: uuidSchema,
  revision: z.string(),
  status: bomStatusSchema,
  isAvailableForNewOrders: z.boolean(),
  isIncomplete: z.boolean(),
  releasedAt: timestampSchema.nullable(),
  releasedByUserId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const bomItemResponseSchema = bomItemCreateSchema.extend({
  id: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const bomOutputVariantSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  sku: z.string().nullable(),
  isActive: z.boolean(),
  isDeleted: z.boolean(),
})

export const bomListItemSchema = bomResponseSchema.extend({
  outputVariant: bomOutputVariantSummarySchema.nullable(),
  availability: bomAvailabilitySchema,
})

export const bomListResponseSchema =
  createPagedListResponseSchema(bomListItemSchema)

export const bomItemListResponseSchema =
  createPagedListResponseSchema(bomItemResponseSchema)

export const createManufacturingCrudOpenApi =
  createCrudOpenApiFactory({
    defaultTag: 'Manufacturing',
  })


export const bomOpenApi = createManufacturingCrudOpenApi({
  resourceName: 'BOM',
  pluralName: 'BOMs',
  querySchema: bomListQuerySchema,
  listResponseSchema: bomListResponseSchema,
  create: {
    schema: bomCreateSchema,
    description: 'Creates a draft BOM.',
  },
  update: {
    schema: bomUpdateSchema,
    description: 'Updates an existing draft BOM.',
  },
  del: {
    schema: bomDeleteSchema,
    description: 'Soft deletes an unused BOM revision and its active items.',
  },
})

export const bomItemOpenApi = createManufacturingCrudOpenApi({
  resourceName: 'BOM item',
  pluralName: 'BOM items',
  querySchema: bomItemListQuerySchema,
  listResponseSchema: bomItemListResponseSchema,
  create: {
    schema: bomItemCreateSchema,
    description: 'Adds a component to a draft BOM.',
  },
  update: {
    schema: bomItemUpdateSchema,
    description: 'Updates a component in a draft BOM.',
  },
  del: {
    schema: bomItemDeleteSchema,
    description: 'Soft deletes an item from a draft BOM.',
  },
})
