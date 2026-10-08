import { z } from 'zod'

export const bomStatusSchema = z.enum(['draft', 'released'])

export type ManufacturingBomStatus =
  z.infer<typeof bomStatusSchema>