import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductPrice, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { InventoryBalance } from '@open-mercato/core/modules/wms/data/entities'
import { SupplierProductionSlot } from '../data/entities'

export type RfqScope = { tenantId: string; organizationId: string }

export type RfqAvailability = {
  status: 'available' | 'nearest_date' | 'unavailable' | 'missing_variant'
  requestedQuantity: number
  requestedDate: string
  feasibleQuantity: number
  offeredDate: string | null
  source: 'wms_and_production'
  fingerprint: string
}

export type RfqPrice = {
  status: 'available' | 'missing'
  amount: number | null
  currencyCode: string | null
  source: 'catalog_product_variant_price' | 'missing'
  priceId: string | null
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function resolveRfqFacts(
  em: EntityManager,
  scope: RfqScope,
  input: { sku: string; quantity: number; requestedDate: string },
): Promise<{ variant: CatalogProductVariant | null; availability: RfqAvailability; price: RfqPrice }> {
  const variant = await em.findOne(CatalogProductVariant, {
    ...scope,
    sku: input.sku,
    isActive: true,
    deletedAt: null,
  })

  if (!variant) {
    return {
      variant: null,
      availability: {
        status: 'missing_variant',
        requestedQuantity: input.quantity,
        requestedDate: input.requestedDate,
        feasibleQuantity: 0,
        offeredDate: null,
        source: 'wms_and_production',
        fingerprint: `missing-variant:${input.sku}`,
      },
      price: { status: 'missing', amount: null, currencyCode: null, source: 'missing', priceId: null },
    }
  }

  const [balances, slots, prices] = await Promise.all([
    em.find(InventoryBalance, { ...scope, catalogVariantId: variant.id, deletedAt: null }),
    em.find(SupplierProductionSlot, { ...scope, catalogVariantId: variant.id, deletedAt: null }, { orderBy: { startsAt: 'asc' } }),
    em.find(CatalogProductPrice, { ...scope, variant: variant.id }, { orderBy: { minQuantity: 'asc', createdAt: 'asc' } }),
  ])

  const availableWms = balances.reduce((total, balance) => total + positiveNumber(balance.quantityAvailable), 0)
  const matchingSlots = slots
    .map((slot) => ({
      date: isoDate(slot.startsAt),
      free: Math.max(0, slot.capacityQuantity - slot.allocations.reduce((total, allocation) => total + positiveNumber(allocation.quantity), 0)),
    }))
    .filter((slot) => slot.date >= input.requestedDate)
  const requestedFree = matchingSlots.find((slot) => slot.date === input.requestedDate)?.free ?? 0
  const totalAvailable = availableWms + requestedFree
  const offeredDate = totalAvailable >= input.quantity
    ? input.requestedDate
    : matchingSlots.find((slot) => availableWms + slot.free >= input.quantity)?.date ?? null
  const status = offeredDate === input.requestedDate
    ? 'available'
    : offeredDate
      ? 'nearest_date'
      : 'unavailable'
  const fingerprint = JSON.stringify({
    variantId: variant.id,
    availableWms,
    slots: matchingSlots,
    requestedDate: input.requestedDate,
    quantity: input.quantity,
  })
  const price = prices
    .filter((candidate) => candidate.minQuantity <= input.quantity && (candidate.maxQuantity === null || candidate.maxQuantity === undefined || candidate.maxQuantity >= input.quantity))
    .map((candidate) => ({
      status: candidate.unitPriceNet || candidate.unitPriceGross ? 'available' as const : 'missing' as const,
      amount: candidate.unitPriceNet ? Number(candidate.unitPriceNet) : candidate.unitPriceGross ? Number(candidate.unitPriceGross) : null,
      currencyCode: candidate.currencyCode?.trim().toUpperCase() || null,
      source: candidate.unitPriceNet || candidate.unitPriceGross ? 'catalog_product_variant_price' as const : 'missing' as const,
      priceId: candidate.id,
    }))
    .find((candidate) => candidate.status === 'available' && candidate.amount !== null && candidate.amount > 0 && candidate.currencyCode) ?? { status: 'missing' as const, amount: null, currencyCode: null, source: 'missing' as const, priceId: null }

  return {
    variant,
    availability: {
      status,
      requestedQuantity: input.quantity,
      requestedDate: input.requestedDate,
      feasibleQuantity: Math.min(input.quantity, totalAvailable),
      offeredDate,
      source: 'wms_and_production',
      fingerprint,
    },
    price,
  }
}

export function buildRfqOffer(input: {
  correlationId: string
  sku: string
  quantity: number
  requestedDate: string
  availability: RfqAvailability
  price: RfqPrice
}): { status: 'ready' | 'blocked'; reason: string | null; offer: Record<string, unknown> | null } {
  if (input.availability.status === 'unavailable' || input.availability.status === 'missing_variant') {
    return { status: 'blocked', reason: 'availability_unconfirmed', offer: null }
  }
  if (input.price.status !== 'available' || input.price.amount === null || !input.price.currencyCode) {
    return { status: 'blocked', reason: 'price_unconfirmed', offer: null }
  }
  const deliveryDate = input.availability.offeredDate ?? input.requestedDate
  return {
    status: 'ready',
    reason: null,
    offer: {
      correlationId: input.correlationId,
      sku: input.sku,
      quantity: input.quantity,
      deliveryDate,
      unitPrice: input.price.amount,
      currencyCode: input.price.currencyCode,
      availabilitySource: input.availability.source,
      priceSource: input.price.source,
    },
  }
}

export function composeRfqReply(input: { sku: string; quantity: number; deliveryDate: string; unitPrice: number; currencyCode: string }): string {
  return `Dzien dobry, potwierdzamy dostepnosc ${input.quantity} sztuk ${input.sku} z dostawa ${input.deliveryDate}. Cena jednostkowa wynosi ${input.unitPrice} ${input.currencyCode}. Prosimy o potwierdzenie zamowienia.`
}
