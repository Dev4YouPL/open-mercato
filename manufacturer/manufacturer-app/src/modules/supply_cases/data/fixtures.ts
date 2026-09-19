import { createHash } from 'node:crypto'
import { buildOutboundIdempotencyKey } from '../lib/outbound/correlationKey'
import type { SeedScenarioOptions, StoreScope } from './repositories'
import type {
  InboundMessageAppendInput,
  OutboundCorrelationRecordInput,
  ProductionOrderCreateInput,
  ProductionPlanCreateInput,
  SupplyCaseCreateInput,
} from './types'

export const FIXTURE_ID_PREFIX = 'sc-fixture'

/**
 * Fixture ids are deterministic per scope rather than globally: the same scope
 * seeded twice yields the same ids, while two scopes seeding the same scenario
 * do not collide on a shared primary key.
 */
export function scopeFingerprint(scope: StoreScope): string {
  return createHash('sha1').update(`${scope.tenantId}:${scope.organizationId}`).digest('hex').slice(0, 8)
}

export type FixtureIds = {
  productionOrder: string
  productionPlan: string
  supplyCase: string
  supplyProposalMessage: string
  alternativeOfferMessage: string
  alternativeRequestCorrelation: string
  supplyProposalRfcMessageId: string
  alternativeOfferRfcMessageId: string
  alternativeRequestRfcMessageId: string
}

export function buildFixtureIds(scope: StoreScope): FixtureIds {
  const suffix = scopeFingerprint(scope)
  return {
    productionOrder: `${FIXTURE_ID_PREFIX}-${suffix}-production-order-1`,
    productionPlan: `${FIXTURE_ID_PREFIX}-${suffix}-production-plan-1`,
    supplyCase: `${FIXTURE_ID_PREFIX}-${suffix}-supply-case-1`,
    supplyProposalMessage: `${FIXTURE_ID_PREFIX}-${suffix}-message-supply-proposal`,
    alternativeOfferMessage: `${FIXTURE_ID_PREFIX}-${suffix}-message-alternative-offer`,
    alternativeRequestCorrelation: `${FIXTURE_ID_PREFIX}-${suffix}-outbound-alternative-request`,
    supplyProposalRfcMessageId: `${FIXTURE_ID_PREFIX}-${suffix}-supply-proposal-1`,
    alternativeOfferRfcMessageId: `${FIXTURE_ID_PREFIX}-${suffix}-alternative-offer-1`,
    alternativeRequestRfcMessageId: `${FIXTURE_ID_PREFIX}-${suffix}-alternative-request-1`,
  }
}

export const FIXTURE_PARTICIPANTS = {
  supplier1: 'supplier@hackon-om-wro.cloud',
  supplier2: 'supplier2@hackon-om-wro.cloud',
  manufacturer: 'manufacturer@hackon-om-wro.cloud',
} as const

export const FIXTURE_DATES = {
  wednesday: '2026-09-16T12:00:00.000Z',
  friday: '2026-09-18T12:00:00.000Z',
  proposalReceivedAt: '2026-09-14T08:00:00.000Z',
  offerReceivedAt: '2026-09-14T14:00:00.000Z',
} as const

export const FIXTURE_MATERIAL_SKU = 'MAT-42'
export const FIXTURE_CORRELATION_ID = 'SC-001'

/**
 * The raw bodies keep the quoted history the sanitizer removes, so the seeded
 * scenario exercises the same raw/sanitized split the transport gate produces
 * for a real message instead of pretending inbound mail arrives pre-cleaned.
 */
export const FIXTURE_PROPOSAL_SANITIZED_BODY =
  'Niestety w srode dostarczymy tylko 300 sztuk MAT-42, pozostale 200 sztuk w piatek.'

export const FIXTURE_PROPOSAL_RAW_BODY = [
  FIXTURE_PROPOSAL_SANITIZED_BODY,
  '',
  'W dniu 2026-09-10 manufacturer@hackon-om-wro.cloud napisal:',
  '> Potwierdzamy zamowienie 500 sztuk MAT-42 na srode.',
].join('\n')

export const FIXTURE_OFFER_SANITIZED_BODY =
  'Mozemy dostarczyc 200 sztuk MAT-42 na srode za 1400 PLN.'

export const FIXTURE_OFFER_RAW_BODY = [
  FIXTURE_OFFER_SANITIZED_BODY,
  '',
  '> Prosimy o oferte na 200 sztuk MAT-42 z dostawa na srode.',
].join('\n')

export type ScenarioFixtures = {
  productionOrder: ProductionOrderCreateInput
  productionPlan: ProductionPlanCreateInput
  supplyCase: SupplyCaseCreateInput
  inboundMessages: InboundMessageAppendInput[]
  outboundCorrelations: OutboundCorrelationRecordInput[]
}

/**
 * Deterministic starting state for the Manufacturer A demo: the plan is still
 * green (Supplier 1 committed the full 500 for Wednesday) while the freshly
 * received proposal already says only 300 will arrive on time.
 */
export function buildScenarioFixtures(scope: StoreScope, options: SeedScenarioOptions = {}): ScenarioFixtures {
  const ids = buildFixtureIds(scope)
  const productionOrder: ProductionOrderCreateInput = {
    id: ids.productionOrder,
    orderNumber: 'PO-1001',
    productSku: 'FG-900',
    quantity: 100,
    materialSku: FIXTURE_MATERIAL_SKU,
    materialQuantity: 500,
    dueDate: FIXTURE_DATES.wednesday,
    customerName: 'Acme Industries',
    customerCommitmentDate: FIXTURE_DATES.friday,
    status: 'RELEASED',
  }

  const productionPlan: ProductionPlanCreateInput = {
    id: ids.productionPlan,
    planNumber: 'PP-2001',
    materialSku: FIXTURE_MATERIAL_SKU,
    requiredQuantity: 500,
    requiredDate: FIXTURE_DATES.wednesday,
    internalStockQuantity: 200,
    supplierCommitments: [
      {
        supplierEmail: FIXTURE_PARTICIPANTS.supplier1,
        quantity: 500,
        deliveryDate: FIXTURE_DATES.wednesday,
        status: 'COMMITTED',
      },
    ],
    productionOrderIds: [ids.productionOrder],
    riskStatus: 'PROTECTED',
  }

  const supplyCase: SupplyCaseCreateInput = {
    id: ids.supplyCase,
    correlationId: FIXTURE_CORRELATION_ID,
    status: options.includeAlternativeOffer ? 'WAITING_FOR_ALTERNATIVE_OFFER' : 'RECEIVED',
    sku: FIXTURE_MATERIAL_SKU,
    requiredQuantity: 500,
    requiredDate: FIXTURE_DATES.wednesday,
    supplier1Email: FIXTURE_PARTICIPANTS.supplier1,
    supplier2Email: options.includeAlternativeOffer ? FIXTURE_PARTICIPANTS.supplier2 : null,
    productionOrderIds: [ids.productionOrder],
    productionPlanId: ids.productionPlan,
    customerCommitmentSnapshot: {
      customerName: 'Acme Industries',
      commitmentDate: FIXTURE_DATES.friday,
    },
    originalCommitment: {
      sku: FIXTURE_MATERIAL_SKU,
      quantity: 500,
      deliveryDate: FIXTURE_DATES.wednesday,
    },
    supplier1Proposal: {
      sku: FIXTURE_MATERIAL_SKU,
      deliveries: [
        { quantity: 300, deliveryDate: FIXTURE_DATES.wednesday },
        { quantity: 200, deliveryDate: FIXTURE_DATES.friday },
      ],
    },
    currency: 'PLN',
  }

  const inboundMessages: InboundMessageAppendInput[] = [
    {
      id: ids.supplyProposalMessage,
      caseId: ids.supplyCase,
      rfcMessageId: ids.supplyProposalRfcMessageId,
      correlationId: FIXTURE_CORRELATION_ID,
      inReplyTo: null,
      messageIntent: 'SUPPLY_PROPOSAL',
      senderEmail: FIXTURE_PARTICIPANTS.supplier1,
      recipientEmail: FIXTURE_PARTICIPANTS.manufacturer,
      payload: {
        schemaVersion: 1,
        sku: FIXTURE_MATERIAL_SKU,
        originalCommitment: { quantity: 500, deliveryDate: FIXTURE_DATES.wednesday },
        feasibleCommitment: [
          { quantity: 300, deliveryDate: FIXTURE_DATES.wednesday },
          { quantity: 200, deliveryDate: FIXTURE_DATES.friday },
        ],
      },
      rawBody: FIXTURE_PROPOSAL_RAW_BODY,
      sanitizedBody: FIXTURE_PROPOSAL_SANITIZED_BODY,
      triageDisposition: 'AUTO_APPLIED',
      receivedAt: FIXTURE_DATES.proposalReceivedAt,
    },
  ]

  const outboundCorrelations: OutboundCorrelationRecordInput[] = []

  if (options.includeAlternativeOffer) {
    // The RFQ we sent to Supplier 2. Without it the seeded offer would be a
    // reply to a Message-ID we never issued, which the thread resolver is
    // required to treat as unmatched evidence rather than a correlation.
    outboundCorrelations.push({
      id: ids.alternativeRequestCorrelation,
      caseId: ids.supplyCase,
      phase: 'ALTERNATIVE_SUPPLY_REQUEST',
      recipientEmail: FIXTURE_PARTICIPANTS.supplier2,
      rfcMessageId: ids.alternativeRequestRfcMessageId,
      idempotencyKey: buildOutboundIdempotencyKey(
        ids.supplyCase,
        'ALTERNATIVE_SUPPLY_REQUEST',
        FIXTURE_PARTICIPANTS.supplier2,
      ),
    })

    inboundMessages.push({
      id: ids.alternativeOfferMessage,
      caseId: ids.supplyCase,
      rfcMessageId: ids.alternativeOfferRfcMessageId,
      correlationId: FIXTURE_CORRELATION_ID,
      inReplyTo: ids.alternativeRequestRfcMessageId,
      references: [ids.alternativeRequestRfcMessageId],
      messageIntent: 'ALTERNATIVE_SUPPLY_OFFER',
      senderEmail: FIXTURE_PARTICIPANTS.supplier2,
      recipientEmail: FIXTURE_PARTICIPANTS.manufacturer,
      payload: {
        schemaVersion: 1,
        sku: FIXTURE_MATERIAL_SKU,
        quantity: 200,
        deliveryDate: FIXTURE_DATES.wednesday,
        price: { amount: 1400, currency: 'PLN' },
      },
      rawBody: FIXTURE_OFFER_RAW_BODY,
      sanitizedBody: FIXTURE_OFFER_SANITIZED_BODY,
      triageDisposition: 'AUTO_APPLIED',
      receivedAt: FIXTURE_DATES.offerReceivedAt,
    })
  }

  return { productionOrder, productionPlan, supplyCase, inboundMessages, outboundCorrelations }
}
