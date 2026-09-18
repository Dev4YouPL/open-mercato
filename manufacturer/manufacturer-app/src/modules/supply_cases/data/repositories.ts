import type {
  InboundMessage,
  InboundMessageAppendInput,
  InboundMessageTriageInput,
  OutboundCorrelation,
  OutboundCorrelationRecordInput,
  ProductionOrder,
  ProductionOrderCreateInput,
  ProductionOrderUpdateInput,
  ProductionPlan,
  ProductionPlanCreateInput,
  ProductionPlanUpdateInput,
  StoreScope,
  SupplyCase,
  SupplyCaseCreateInput,
  SupplyCaseUpdateInput,
} from './types'

export type { StoreScope }

export type ListFilter<TRecord> = {
  includeDeleted?: boolean
  where?: Partial<Record<keyof TRecord & string, string | number | boolean | null>>
}

export type ScopedRepository<TRecord, TCreateInput, TUpdateInput> = {
  create(scope: StoreScope, input: TCreateInput): Promise<TRecord>
  findById(scope: StoreScope, id: string): Promise<TRecord | null>
  requireById(scope: StoreScope, id: string): Promise<TRecord>
  list(scope: StoreScope, filter?: ListFilter<TRecord>): Promise<TRecord[]>
  update(scope: StoreScope, id: string, patch: TUpdateInput): Promise<TRecord>
  softDelete(scope: StoreScope, id: string): Promise<void>
}

export type ProductionOrderRepository = ScopedRepository<
  ProductionOrder,
  ProductionOrderCreateInput,
  ProductionOrderUpdateInput
> & {
  findByOrderNumber(scope: StoreScope, orderNumber: string): Promise<ProductionOrder | null>
}

export type ProductionPlanRepository = ScopedRepository<
  ProductionPlan,
  ProductionPlanCreateInput,
  ProductionPlanUpdateInput
> & {
  findByPlanNumber(scope: StoreScope, planNumber: string): Promise<ProductionPlan | null>
}

export type SupplyCaseRepository = ScopedRepository<SupplyCase, SupplyCaseCreateInput, SupplyCaseUpdateInput> & {
  findByCorrelationId(scope: StoreScope, correlationId: string): Promise<SupplyCase | null>
}

export type AppendedInboundMessage = {
  message: InboundMessage
  created: boolean
}

/**
 * Append-only by construction: the contract exposes no update or delete. A
 * runtime guard on the concrete implementation covers untyped callers.
 *
 * `appendIfAbsent` is the transport gate's claim: the scoped `rfcMessageId`
 * check runs inside the same critical section as the write, so a re-delivered
 * message yields `created: false` rather than a second record.
 */
export type InboundMessageRepository = {
  append(scope: StoreScope, input: InboundMessageAppendInput): Promise<InboundMessage>
  appendIfAbsent(scope: StoreScope, input: InboundMessageAppendInput): Promise<AppendedInboundMessage>
  findById(scope: StoreScope, id: string): Promise<InboundMessage | null>
  findByRfcMessageId(scope: StoreScope, rfcMessageId: string): Promise<InboundMessage | null>
  list(scope: StoreScope, filter?: ListFilter<InboundMessage>): Promise<InboundMessage[]>
  /**
   * Records what triage concluded. It is the ONE exception to append-only, and a
   * narrow one: it writes only the fields that are null by design until a
   * message is classified, never a fact the sender wrote. A message that already
   * carries a disposition is refused, so a re-delivered message or a replayed
   * workflow step cannot re-decide a case that is already linked.
   */
  recordTriage(scope: StoreScope, id: string, patch: InboundMessageTriageInput): Promise<InboundMessage>
}

export type RecordedOutboundCorrelation = {
  correlation: OutboundCorrelation
  created: boolean
}

/**
 * Append-only like the inbound intake, for the same reason: what we sent is a
 * historical fact. `recordIfAbsent` claims on the idempotency key so a retried
 * send reuses the anchor instead of minting a second `Message-ID` the eventual
 * reply could no longer be matched against.
 */
export type OutboundCorrelationRepository = {
  record(scope: StoreScope, input: OutboundCorrelationRecordInput): Promise<OutboundCorrelation>
  recordIfAbsent(scope: StoreScope, input: OutboundCorrelationRecordInput): Promise<RecordedOutboundCorrelation>
  findByRfcMessageId(scope: StoreScope, rfcMessageId: string): Promise<OutboundCorrelation | null>
  findByIdempotencyKey(scope: StoreScope, idempotencyKey: string): Promise<OutboundCorrelation | null>
  list(scope: StoreScope, filter?: ListFilter<OutboundCorrelation>): Promise<OutboundCorrelation[]>
}

export type SeedScenarioOptions = {
  includeAlternativeOffer?: boolean
}

export type SeededScenario = {
  productionOrder: ProductionOrder
  productionPlan: ProductionPlan
  supplyCase: SupplyCase
  inboundMessages: InboundMessage[]
  outboundCorrelations: OutboundCorrelation[]
}

export type SupplyCasesStore = {
  productionOrders: ProductionOrderRepository
  productionPlans: ProductionPlanRepository
  supplyCases: SupplyCaseRepository
  inboundMessages: InboundMessageRepository
  outboundCorrelations: OutboundCorrelationRepository
  seedScenario(scope: StoreScope, options?: SeedScenarioOptions): Promise<SeededScenario>
  resetScenario(scope: StoreScope, options?: SeedScenarioOptions): Promise<SeededScenario>
  purgeScope(scope: StoreScope): Promise<void>
}
