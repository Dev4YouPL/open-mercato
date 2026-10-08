import { z } from 'zod'

import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema,
} from '@open-mercato/shared/lib/openapi/crud'

import { bomStatusSchema } from '../data/bomStatus'

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

export const bomResponseSchema = bomCreateSchema.extend({
  id: uuidSchema,
  revision: z.string(),
  status: bomStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const bomItemResponseSchema = bomItemCreateSchema.extend({
  id: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const bomListResponseSchema =
  createPagedListResponseSchema(bomResponseSchema)

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
    description: 'Soft deletes a draft BOM and its active items.',
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