import { z } from 'zod'

import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import {
  resolveTranslations,
} from '@open-mercato/shared/lib/i18n/server'

import {
  bomCreateSchema,
  bomDeleteSchema,
  bomItemCreateSchema,
  bomItemDeleteSchema,
  bomItemUpdateSchema,
  bomUpdateSchema,
} from '../data/validators'
import {
  resolveBomCommandScope,
} from '../lib/bomCommandHelpers'
import type { BomScope } from '../lib/bomValidation'

type ManufacturingActionInput = {
  raw: unknown
  ctx: CrudCtx
}

export const manufacturingDeleteRequestSchema = z
  .object({
    body: z.record(z.string(), z.unknown()).default({}),
    query: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export async function resolveManufacturingApiScope(
  ctx: CrudCtx,
): Promise<BomScope> {
  const { translate } = await resolveTranslations()

  return resolveBomCommandScope(
    ctx,
    translate('manufacturing.errors.scopeRequired'),
  )
}

async function parseManufacturingCommandInput<TInput>(
  schema: z.ZodType<TInput>,
  raw: unknown,
  ctx: CrudCtx,
): Promise<TInput> {
  await resolveManufacturingApiScope(ctx)

  return schema.parse(raw)
}

async function parseManufacturingDeleteInput<TInput>(
  schema: z.ZodType<TInput>,
  raw: unknown,
  ctx: CrudCtx,
): Promise<TInput> {
  await resolveManufacturingApiScope(ctx)

  const request = manufacturingDeleteRequestSchema.parse(raw)

  return schema.parse({
    ...request.query,
    ...request.body,
  })
}

export function mapBomCreateInput({
  raw,
  ctx,
}: ManufacturingActionInput) {
  return parseManufacturingCommandInput(
    bomCreateSchema,
    raw,
    ctx,
  )
}

export function mapBomUpdateInput({
  raw,
  ctx,
}: ManufacturingActionInput) {
  return parseManufacturingCommandInput(
    bomUpdateSchema,
    raw,
    ctx,
  )
}

export function mapBomDeleteInput({
  raw,
  ctx,
}: ManufacturingActionInput) {
  return parseManufacturingDeleteInput(
    bomDeleteSchema,
    raw,
    ctx,
  )
}

export function mapBomItemCreateInput({
  raw,
  ctx,
}: ManufacturingActionInput) {
  return parseManufacturingCommandInput(
    bomItemCreateSchema,
    raw,
    ctx,
  )
}

export function mapBomItemUpdateInput({
  raw,
  ctx,
}: ManufacturingActionInput) {
  return parseManufacturingCommandInput(
    bomItemUpdateSchema,
    raw,
    ctx,
  )
}

export function mapBomItemDeleteInput({
  raw,
  ctx,
}: ManufacturingActionInput) {
  return parseManufacturingDeleteInput(
    bomItemDeleteSchema,
    raw,
    ctx,
  )
}