import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import {
  AppendOnlyViolationError,
  DuplicateRfcMessageIdError,
  DuplicateRecordKeyError,
  RecordNotFoundError,
  ScopeMismatchError,
} from '../errors'
import type {
  AppendedInboundMessage,
  InboundMessageRepository,
  ListFilter,
  OutboundCorrelationRepository,
  RecordedOutboundCorrelation,
  ProductionOrderRepository,
  ProductionPlanRepository,
  SeedScenarioOptions,
  SeededScenario,
  SupplyCaseRepository,
  SupplyCasesStore,
} from '../repositories'
import {
  productionOrderCreateSchema,
  productionOrderSchema,
  productionOrderUpdateSchema,
  productionPlanCreateSchema,
  productionPlanSchema,
  productionPlanUpdateSchema,
  inboundMessageAppendSchema,
  inboundMessageSchema,
  inboundMessageTriageSchema,
  outboundCorrelationRecordSchema,
  outboundCorrelationSchema,
  supplyCaseCreateSchema,
  supplyCaseSchema,
  supplyCaseUpdateSchema,
} from '../types'
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
} from '../types'
import { JsonCollection, type AtomicWriter } from './collection'
import { buildScenarioFixtures } from '../fixtures'

export const DEFAULT_DATA_DIR = path.join('.mercato', 'supply-cases')

export const STORE_FILE_NAMES = {
  productionOrders: 'production-orders.json',
  productionPlans: 'production-plans.json',
  supplyCases: 'supply-cases.json',
  inboundMessages: 'inbound-messages.json',
  outboundCorrelations: 'outbound-correlations.json',
} as const

export type StoreClock = {
  now(): string
  newId(): string
}

export const systemStoreClock: StoreClock = {
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
}

export function resolveDataDir(): string {
  const configured = process.env.OM_SUPPLY_CASES_DATA_DIR?.trim()
  return path.resolve(process.cwd(), configured && configured.length > 0 ? configured : DEFAULT_DATA_DIR)
}

type ScopedRecord = {
  id: string
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function stripUndefined<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function isInScope(record: { tenantId: string; organizationId: string }, scope: StoreScope): boolean {
  return record.tenantId === scope.tenantId && record.organizationId === scope.organizationId
}

/**
 * The durable dedupe key from the spec: tenant + organization + RFC 5322
 * Message-ID. Kept in one place so the lookup and the append-time duplicate
 * check cannot drift apart. The collection holds inbound intake only, so the
 * key needs no direction: our own outbound Message-IDs stay in
 * `communication_channels` and can never collide with it.
 */
function matchesDedupeKey(record: InboundMessage, scope: StoreScope, rfcMessageId: string): boolean {
  return isInScope(record, scope) && record.rfcMessageId === rfcMessageId
}

function matchesWhere(record: object, where: ListFilter<never>['where']): boolean {
  if (!where) return true
  const indexed = record as Record<string, unknown>
  return Object.entries(where).every(([key, value]) => indexed[key] === value)
}

function byCreationOrder(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  if (left.createdAt === right.createdAt) return left.id.localeCompare(right.id)
  return left.createdAt.localeCompare(right.createdAt)
}

type ScopedRepositoryConfig<TRecord extends ScopedRecord, TCreate extends object, TUpdate extends object> = {
  entity: string
  collection: JsonCollection<TRecord>
  recordSchema: z.ZodType<TRecord>
  createSchema: z.ZodType<TCreate>
  updateSchema: z.ZodType<TUpdate>
  uniqueField: keyof TRecord & string
  buildDefaults: () => Record<string, unknown>
  clock: StoreClock
}

function createScopedRepository<TRecord extends ScopedRecord, TCreate extends object, TUpdate extends object>(
  config: ScopedRepositoryConfig<TRecord, TCreate, TUpdate>,
) {
  const { entity, collection, recordSchema, createSchema, updateSchema, uniqueField, buildDefaults, clock } = config

  const liveInScope = (records: TRecord[], scope: StoreScope, includeDeleted = false): TRecord[] =>
    records.filter((record) => isInScope(record, scope) && (includeDeleted || record.deletedAt === null))

  async function create(scope: StoreScope, rawInput: TCreate): Promise<TRecord> {
    const input = stripUndefined(createSchema.parse(rawInput))
    const timestamp = clock.now()
    const candidate: unknown = {
      ...buildDefaults(),
      ...input,
      id: typeof input.id === 'string' && input.id.length > 0 ? input.id : clock.newId(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    }
    const record = recordSchema.parse(candidate)

    return collection.mutate((records) => {
      const existingById = records.find((entry) => entry.id === record.id)
      if (existingById) {
        // An explicit id that already belongs to another tenant is a caller
        // bug, not a duplicate: reporting it as a duplicate would tell the
        // caller a record exists in a scope it may not read.
        if (!isInScope(existingById, scope)) throw new ScopeMismatchError(entity)
        throw new DuplicateRecordKeyError(entity, 'id', record.id)
      }

      const uniqueValue = record[uniqueField]
      const duplicate = liveInScope(records, scope, true).find((entry) => entry[uniqueField] === uniqueValue)
      if (duplicate) throw new DuplicateRecordKeyError(entity, uniqueField, String(uniqueValue))

      return { records: [...records, record], result: record }
    })
  }

  async function findById(scope: StoreScope, id: string): Promise<TRecord | null> {
    const records = await collection.readAll()
    return liveInScope(records, scope).find((record) => record.id === id) ?? null
  }

  async function requireById(scope: StoreScope, id: string): Promise<TRecord> {
    const record = await findById(scope, id)
    if (!record) throw new RecordNotFoundError(entity, id)
    return record
  }

  async function findByUniqueField(scope: StoreScope, value: string): Promise<TRecord | null> {
    const records = await collection.readAll()
    return liveInScope(records, scope).find((record) => record[uniqueField] === value) ?? null
  }

  async function list(scope: StoreScope, filter?: ListFilter<TRecord>): Promise<TRecord[]> {
    const records = await collection.readAll()
    return liveInScope(records, scope, filter?.includeDeleted)
      .filter((record) => matchesWhere(record, filter?.where))
      .sort(byCreationOrder)
  }

  async function update(scope: StoreScope, id: string, rawPatch: TUpdate): Promise<TRecord> {
    const patch = stripUndefined(updateSchema.parse(rawPatch))
    return collection.mutate((records) => {
      const index = records.findIndex(
        (record) => record.id === id && isInScope(record, scope) && record.deletedAt === null,
      )
      if (index === -1) throw new RecordNotFoundError(entity, id)
      const candidate: unknown = { ...records[index], ...patch, updatedAt: clock.now() }
      const next = recordSchema.parse(candidate)
      const updated = [...records]
      updated[index] = next
      return { records: updated, result: next }
    })
  }

  async function softDelete(scope: StoreScope, id: string): Promise<void> {
    await collection.mutate((records) => {
      const index = records.findIndex(
        (record) => record.id === id && isInScope(record, scope) && record.deletedAt === null,
      )
      if (index === -1) throw new RecordNotFoundError(entity, id)
      const timestamp = clock.now()
      const updated = [...records]
      updated[index] = { ...records[index], deletedAt: timestamp, updatedAt: timestamp }
      return { records: updated, result: undefined }
    })
  }

  async function purgeScope(scope: StoreScope): Promise<void> {
    await collection.mutate((records) => ({
      records: records.filter((record) => !isInScope(record, scope)),
      result: undefined,
    }))
  }

  return { create, findById, requireById, findByUniqueField, list, update, softDelete, purgeScope }
}

class JsonInboundMessageRepository implements InboundMessageRepository {
  private readonly collection: JsonCollection<InboundMessage>
  private readonly clock: StoreClock

  constructor(collection: JsonCollection<InboundMessage>, clock: StoreClock) {
    this.collection = collection
    this.clock = clock
  }

  async append(scope: StoreScope, input: InboundMessageAppendInput): Promise<InboundMessage> {
    const outcome = await this.appendInternal(scope, input, 'throw')
    return outcome.message
  }

  async appendIfAbsent(scope: StoreScope, input: InboundMessageAppendInput): Promise<AppendedInboundMessage> {
    return this.appendInternal(scope, input, 'reuse')
  }

  async findById(scope: StoreScope, id: string): Promise<InboundMessage | null> {
    const records = await this.collection.readAll()
    return records.find((record) => record.id === id && isInScope(record, scope)) ?? null
  }

  async findByRfcMessageId(scope: StoreScope, rfcMessageId: string): Promise<InboundMessage | null> {
    const records = await this.collection.readAll()
    return records.find((record) => matchesDedupeKey(record, scope, rfcMessageId)) ?? null
  }

  async list(scope: StoreScope, filter?: ListFilter<InboundMessage>): Promise<InboundMessage[]> {
    const records = await this.collection.readAll()
    return records
      .filter((record) => isInScope(record, scope))
      .filter((record) => matchesWhere(record, filter?.where))
      .sort(byCreationOrder)
  }

  async recordTriage(scope: StoreScope, id: string, rawPatch: InboundMessageTriageInput): Promise<InboundMessage> {
    const patch = inboundMessageTriageSchema.parse(rawPatch)
    return this.collection.mutate((records) => {
      const index = records.findIndex((record) => record.id === id && isInScope(record, scope))
      if (index === -1) throw new RecordNotFoundError('InboundMessage', id)
      const current = records[index]
      // A disposed message is settled. Re-deciding it would let a redelivery or
      // a replayed step move a message off the case it is already linked to.
      if (current.triageDisposition !== null || current.triageOutcome !== null) {
        throw new AppendOnlyViolationError('InboundMessage', 're-triaged')
      }
      const updated = [...records]
      updated[index] = inboundMessageSchema.parse({ ...current, ...patch })
      return { records: updated, result: updated[index] }
    })
  }

  /**
   * Second line of defence for callers that reach the implementation without
   * the append-only contract in their types.
   */
  update(): never {
    throw new AppendOnlyViolationError('InboundMessage', 'updated')
  }

  delete(): never {
    throw new AppendOnlyViolationError('InboundMessage', 'deleted')
  }

  async purgeScope(scope: StoreScope): Promise<void> {
    await this.collection.mutate((records) => ({
      records: records.filter((record) => !isInScope(record, scope)),
      result: undefined,
    }))
  }

  private async appendInternal(
    scope: StoreScope,
    rawInput: InboundMessageAppendInput,
    onDuplicate: 'throw' | 'reuse',
  ): Promise<AppendedInboundMessage> {
    const input = stripUndefined(inboundMessageAppendSchema.parse(rawInput))
    const candidate: unknown = {
      caseId: null,
      correlationId: null,
      inReplyTo: null,
      references: [],
      // Null rather than UNRELATED: before triage the message is unclassified,
      // and defaulting to a real intent would make an unread message look like
      // one a classifier had already dismissed.
      messageIntent: null,
      payload: null,
      rawBody: null,
      sanitizedBody: null,
      extraction: null,
      extractionConfidence: null,
      triageDisposition: null,
      triageOutcome: null,
      candidateIndexes: [],
      needsAttention: false,
      providerMessageId: null,
      failureReason: null,
      receivedAt: null,
      ...input,
      id: typeof input.id === 'string' && input.id.length > 0 ? input.id : this.clock.newId(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      createdAt: this.clock.now(),
    }
    const record = inboundMessageSchema.parse(candidate)

    // The duplicate check runs inside the mutation so two concurrent replays of
    // the same rfcMessageId cannot both observe an empty slot. Losing that race
    // is a normal idempotent outcome, which is why `appendIfAbsent` returns the
    // winner instead of raising.
    return this.collection.mutate<AppendedInboundMessage>((records) => {
      const duplicate = records.find((entry) => matchesDedupeKey(entry, scope, record.rfcMessageId))
      if (duplicate) {
        if (onDuplicate === 'throw') {
          throw new DuplicateRfcMessageIdError(record.rfcMessageId)
        }
        return { records, result: { message: duplicate, created: false } }
      }

      const idCollision = records.find((entry) => entry.id === record.id)
      if (idCollision) {
        if (!isInScope(idCollision, scope)) throw new ScopeMismatchError('InboundMessage')
        throw new DuplicateRecordKeyError('InboundMessage', 'id', record.id)
      }

      return { records: [...records, record], result: { message: record, created: true } }
    })
  }
}

class JsonOutboundCorrelationRepository implements OutboundCorrelationRepository {
  private readonly collection: JsonCollection<OutboundCorrelation>
  private readonly clock: StoreClock

  constructor(collection: JsonCollection<OutboundCorrelation>, clock: StoreClock) {
    this.collection = collection
    this.clock = clock
  }

  async record(scope: StoreScope, input: OutboundCorrelationRecordInput): Promise<OutboundCorrelation> {
    const outcome = await this.recordInternal(scope, input, 'throw')
    return outcome.correlation
  }

  async recordIfAbsent(
    scope: StoreScope,
    input: OutboundCorrelationRecordInput,
  ): Promise<RecordedOutboundCorrelation> {
    return this.recordInternal(scope, input, 'reuse')
  }

  async findByRfcMessageId(scope: StoreScope, rfcMessageId: string): Promise<OutboundCorrelation | null> {
    const records = await this.collection.readAll()
    return records.find((record) => isInScope(record, scope) && record.rfcMessageId === rfcMessageId) ?? null
  }

  async findByIdempotencyKey(scope: StoreScope, idempotencyKey: string): Promise<OutboundCorrelation | null> {
    const records = await this.collection.readAll()
    return records.find((record) => isInScope(record, scope) && record.idempotencyKey === idempotencyKey) ?? null
  }

  async list(scope: StoreScope, filter?: ListFilter<OutboundCorrelation>): Promise<OutboundCorrelation[]> {
    const records = await this.collection.readAll()
    return records
      .filter((record) => isInScope(record, scope))
      .filter((record) => matchesWhere(record, filter?.where))
      .sort(byCreationOrder)
  }

  update(): never {
    throw new AppendOnlyViolationError('OutboundCorrelation', 'updated')
  }

  delete(): never {
    throw new AppendOnlyViolationError('OutboundCorrelation', 'deleted')
  }

  async purgeScope(scope: StoreScope): Promise<void> {
    await this.collection.mutate((records) => ({
      records: records.filter((record) => !isInScope(record, scope)),
      result: undefined,
    }))
  }

  private async recordInternal(
    scope: StoreScope,
    rawInput: OutboundCorrelationRecordInput,
    onDuplicate: 'throw' | 'reuse',
  ): Promise<RecordedOutboundCorrelation> {
    const input = stripUndefined(outboundCorrelationRecordSchema.parse(rawInput))
    const candidate: unknown = {
      ...input,
      id: typeof input.id === 'string' && input.id.length > 0 ? input.id : this.clock.newId(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      createdAt: this.clock.now(),
    }
    const record = outboundCorrelationSchema.parse(candidate)

    return this.collection.mutate<RecordedOutboundCorrelation>((records) => {
      const scoped = records.filter((entry) => isInScope(entry, scope))

      // The idempotency key is checked first: a retried send is the expected
      // duplicate, and reusing its anchor is what keeps the eventual reply
      // correlatable to the message the supplier actually holds.
      const byKey = scoped.find((entry) => entry.idempotencyKey === record.idempotencyKey)
      if (byKey) {
        if (onDuplicate === 'throw') {
          throw new DuplicateRecordKeyError('OutboundCorrelation', 'idempotencyKey', record.idempotencyKey)
        }
        return { records, result: { correlation: byKey, created: false } }
      }

      // A repeated Message-ID under a DIFFERENT idempotency key is never a
      // retry — it would make one sent message answer for two phases — so it
      // raises even in reuse mode.
      const byMessageId = scoped.find((entry) => entry.rfcMessageId === record.rfcMessageId)
      if (byMessageId) {
        throw new DuplicateRecordKeyError('OutboundCorrelation', 'rfcMessageId', record.rfcMessageId)
      }

      const idCollision = records.find((entry) => entry.id === record.id)
      if (idCollision) {
        if (!isInScope(idCollision, scope)) throw new ScopeMismatchError('OutboundCorrelation')
        throw new DuplicateRecordKeyError('OutboundCorrelation', 'id', record.id)
      }

      return { records: [...records, record], result: { correlation: record, created: true } }
    })
  }
}

export type JsonSupplyCasesStoreOptions = {
  dataDir?: string
  clock?: StoreClock
  writer?: AtomicWriter
}

export function createJsonSupplyCasesStore(options: JsonSupplyCasesStoreOptions = {}): SupplyCasesStore {
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : resolveDataDir()
  const clock = options.clock ?? systemStoreClock
  const writer = options.writer

  const collectionFor = <TRecord>(fileName: string, recordSchema: z.ZodType<TRecord>) =>
    new JsonCollection<TRecord>({ filePath: path.join(dataDir, fileName), recordSchema, writer })

  const orders = createScopedRepository<ProductionOrder, ProductionOrderCreateInput, ProductionOrderUpdateInput>({
    entity: 'ProductionOrder',
    collection: collectionFor(STORE_FILE_NAMES.productionOrders, productionOrderSchema),
    recordSchema: productionOrderSchema,
    createSchema: productionOrderCreateSchema,
    updateSchema: productionOrderUpdateSchema,
    uniqueField: 'orderNumber',
    buildDefaults: () => ({ status: 'PLANNED' }),
    clock,
  })

  const plans = createScopedRepository<ProductionPlan, ProductionPlanCreateInput, ProductionPlanUpdateInput>({
    entity: 'ProductionPlan',
    collection: collectionFor(STORE_FILE_NAMES.productionPlans, productionPlanSchema),
    recordSchema: productionPlanSchema,
    createSchema: productionPlanCreateSchema,
    updateSchema: productionPlanUpdateSchema,
    uniqueField: 'planNumber',
    buildDefaults: () => ({
      internalStockQuantity: 0,
      supplierCommitments: [],
      productionOrderIds: [],
      riskStatus: 'AT_RISK',
    }),
    clock,
  })

  const cases = createScopedRepository<SupplyCase, SupplyCaseCreateInput, SupplyCaseUpdateInput>({
    entity: 'SupplyCase',
    collection: collectionFor(STORE_FILE_NAMES.supplyCases, supplyCaseSchema),
    recordSchema: supplyCaseSchema,
    createSchema: supplyCaseCreateSchema,
    updateSchema: supplyCaseUpdateSchema,
    uniqueField: 'correlationId',
    buildDefaults: () => ({
      status: 'RECEIVED',
      needsAttentionReason: null,
      supplier1Email: null,
      supplier2Email: null,
      productionOrderIds: [],
      productionPlanId: null,
      customerCommitmentSnapshot: null,
      originalCommitment: null,
      supplier1Proposal: null,
      alternativeOffer: null,
      initialAnalysis: null,
      initialOptions: null,
      selectedInitialOptionId: null,
      finalAnalysis: null,
      resolutionPlans: null,
      selectedResolutionPlanId: null,
      pendingResolutionPlan: null,
      estimatedAdditionalCost: null,
      actualAdditionalCost: null,
      currency: 'PLN',
      supplier1ConfirmedAt: null,
      supplier2ConfirmedAt: null,
      workflowInstanceId: null,
      resolvedAt: null,
    }),
    clock,
  })

  const messages = new JsonInboundMessageRepository(
    collectionFor(STORE_FILE_NAMES.inboundMessages, inboundMessageSchema),
    clock,
  )

  const correlations = new JsonOutboundCorrelationRepository(
    collectionFor(STORE_FILE_NAMES.outboundCorrelations, outboundCorrelationSchema),
    clock,
  )

  const productionOrders: ProductionOrderRepository = {
    create: orders.create,
    findById: orders.findById,
    requireById: orders.requireById,
    list: orders.list,
    update: orders.update,
    softDelete: orders.softDelete,
    findByOrderNumber: orders.findByUniqueField,
  }

  const productionPlans: ProductionPlanRepository = {
    create: plans.create,
    findById: plans.findById,
    requireById: plans.requireById,
    list: plans.list,
    update: plans.update,
    softDelete: plans.softDelete,
    findByPlanNumber: plans.findByUniqueField,
  }

  const supplyCases: SupplyCaseRepository = {
    create: cases.create,
    findById: cases.findById,
    requireById: cases.requireById,
    list: cases.list,
    update: cases.update,
    softDelete: cases.softDelete,
    findByCorrelationId: cases.findByUniqueField,
  }

  const store: SupplyCasesStore = {
    productionOrders,
    productionPlans,
    supplyCases,
    inboundMessages: messages,
    outboundCorrelations: correlations,

    async purgeScope(scope: StoreScope): Promise<void> {
      // Sequential on purpose: each collection serializes its own writes, and a
      // reset is administrative rather than latency sensitive.
      await orders.purgeScope(scope)
      await plans.purgeScope(scope)
      await cases.purgeScope(scope)
      await messages.purgeScope(scope)
      await correlations.purgeScope(scope)
    },

    async seedScenario(scope: StoreScope, seedOptions: SeedScenarioOptions = {}): Promise<SeededScenario> {
      const fixtures = buildScenarioFixtures(scope, seedOptions)
      const productionOrder = await productionOrders.create(scope, fixtures.productionOrder)
      const productionPlan = await productionPlans.create(scope, fixtures.productionPlan)
      const supplyCase = await supplyCases.create(scope, fixtures.supplyCase)
      const outboundCorrelations: OutboundCorrelation[] = []
      // Seeded before the inbound messages: the offer fixture replies to the
      // RFQ, so the anchor has to exist for that reply to resolve to anything.
      for (const correlation of fixtures.outboundCorrelations) {
        outboundCorrelations.push(await correlations.record(scope, correlation))
      }
      const inboundMessages: InboundMessage[] = []
      for (const message of fixtures.inboundMessages) {
        inboundMessages.push(await messages.append(scope, message))
      }
      return { productionOrder, productionPlan, supplyCase, inboundMessages, outboundCorrelations }
    },

    async resetScenario(scope: StoreScope, seedOptions: SeedScenarioOptions = {}): Promise<SeededScenario> {
      await store.purgeScope(scope)
      return store.seedScenario(scope, seedOptions)
    },
  }

  return store
}
