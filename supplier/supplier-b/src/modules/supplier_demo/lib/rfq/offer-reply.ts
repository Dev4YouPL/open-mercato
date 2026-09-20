import { z } from 'zod'

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const rfqOfferFactsSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  deliveryDate: z.string().refine(isCalendarDate, '[internal] expected a calendar date'),
  unitPrice: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict()

export type RfqOfferFacts = z.infer<typeof rfqOfferFactsSchema>

export type ComposeRfqOfferReplyInput = RfqOfferFacts & {
  correlationId: string
  inReplyToMessageId?: string | null
}

export const composeRfqOfferReplyInputSchema = rfqOfferFactsSchema.extend({
  correlationId: z.string().min(1),
  inReplyToMessageId: z.string().min(1).nullable().optional(),
}).strict()

export type ComposedRfqOfferReply = {
  subject: string
  body: string
  plain: string
  facts: RfqOfferFacts
  inReplyToMessageId: string | null
}

export function parseRfqOfferFacts(value: unknown): RfqOfferFacts {
  return rfqOfferFactsSchema.parse(value)
}

export function composeRfqOfferReply(input: ComposeRfqOfferReplyInput): ComposedRfqOfferReply {
  const parsed = composeRfqOfferReplyInputSchema.parse(input)
  const facts: RfqOfferFacts = {
    sku: parsed.sku,
    quantity: parsed.quantity,
    deliveryDate: parsed.deliveryDate,
    unitPrice: parsed.unitPrice,
    currency: parsed.currency,
  }
  const price = parsed.unitPrice.toFixed(2)
  const subject = `Re: RFQ ${parsed.correlationId}: ${parsed.sku}`
  const body = `Offer for ${parsed.sku}: ${parsed.quantity} units available for delivery on ${parsed.deliveryDate} at ${price} ${parsed.currency} per unit.`
  return {
    subject,
    body,
    plain: body,
    facts,
    inReplyToMessageId: parsed.inReplyToMessageId ?? null,
  }
}
