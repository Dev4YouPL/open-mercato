import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { InventoryBalance, InventoryReservation, Warehouse, WarehouseLocation, SalesOrderWarehouseAssignment } from '@open-mercato/core/modules/wms/data/entities'
import { resolveStatusEntryIdByValue } from '@open-mercato/core/modules/sales/lib/statusHelpers'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { setup as communicationChannelsSetup } from '@open-mercato/core/modules/communication_channels/setup'
import { COMMUNICATION_CHANNELS_QUEUES } from '@open-mercato/core/modules/communication_channels/lib/queue'
import { ScheduledJob } from '@open-mercato/scheduler'
import { SupplyCase, SupplyMessage, SupplierProductionSlot } from './data/entities'
import supplierDemoEncryptionMaps from './encryption'
import { ensureAutoSupplyProposalToggle, ensureAutoSupplyReplyToggle, ensureDemoProductionSlots, setup } from './setup'
import { sendSupplyMail, resolveMailboxPollChannel } from './lib/mailbox'
import { requestMailboxPoll } from './lib/mailbox-poll'
import { resolveSupplyRecipient } from './lib/recipient'
import { isAutoSupplyProposalEnabled, isAutoSupplyReplyEnabled, supplierDemoReplyToggleId, supplierDemoToggleId } from './lib/toggles'
import { renderSupplyEnvelope, type SupplyEnvelope } from './lib/envelope'
import { parseInboundSupplyText } from './lib/envelope-parse'
import { validateInboundEnvelope } from './lib/inbound-validation'
import { evaluateFeasibility } from './lib/feasibility'

type Scope = { tenantId: string; organizationId: string }

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token?.startsWith('--')) continue
    const [key, inline] = token.slice(2).split('=', 2)
    const next = rest[index + 1]
    if (inline !== undefined) {
      args[key] = inline
    } else if (next !== undefined && !next.startsWith('--')) {
      args[key] = next
      index += 1
    } else {
      // A bare flag such as --inject.
      args[key] = 'true'
    }
  }
  return args
}

function slotPriority(args: Record<string, string>): 'normal' | 'high' {
  const value = args['so442-priority'] ?? 'normal'
  if (value !== 'normal' && value !== 'high') throw new Error('[internal] --so442-priority must be normal or high.')
  return value
}

async function scopeFor(em: EntityManager, args: Record<string, string>): Promise<Scope> {
  const configured = { tenantId: args['tenant-id'] ?? process.env.SUPPLIER_DEMO_TENANT_ID, organizationId: args['organization-id'] ?? process.env.SUPPLIER_DEMO_ORGANIZATION_ID }
  if (configured.tenantId && configured.organizationId) return configured as Scope
  const warehouse = await em.findOne(Warehouse, { deletedAt: null }, { orderBy: { createdAt: 'asc' } })
  if (!warehouse) throw new Error('[internal] Usage requires --tenant-id and --organization-id when no demo warehouse exists.')
  return { tenantId: warehouse.tenantId, organizationId: warehouse.organizationId }
}

function commandContext(container: CommandRuntimeContext['container'], scope: Scope): CommandRuntimeContext {
  return { container, auth: { tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'], organizationScope: { selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId], tenantId: scope.tenantId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], systemActor: true }
}

function sameAllocations(actual: ReadonlyArray<Record<string, unknown>> | null | undefined, expected: ReadonlyArray<Record<string, unknown>>): boolean {
  const rows = actual ?? []
  return rows.length === expected.length && expected.every((wanted, index) => {
    const row = rows[index] ?? {}
    return row.orderNumber === wanted.orderNumber && Number(row.quantity) === Number(wanted.quantity) && row.priority === wanted.priority && new Date(String(row.slaDueAt ?? '')).getTime() === new Date(String(wanted.slaDueAt ?? '')).getTime()
  })
}

async function restoreSlots(em: EntityManager, scope: Scope, priority: 'normal' | 'high'): Promise<void> {
  const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null })
  const orders = await findWithDecryption(em, SalesOrder, { ...scope, deletedAt: null, orderNumber: { $like: 'SO-44%' } }, { orderBy: { createdAt: 'desc' } }, scope)
  const order441 = orders.find((order) => order.orderNumber.startsWith('SO-441') && !['canceled', 'cancelled'].includes(order.status ?? ''))
  const order442 = orders.find((order) => order.orderNumber.startsWith('SO-442') && !['canceled', 'cancelled'].includes(order.status ?? ''))
  if (!variant || !order441?.expectedDeliveryAt || !order442) throw new Error('[internal] Supplier demo slot seed is incomplete.')
  await ensureDemoProductionSlots(em, scope, variant, order441.expectedDeliveryAt, order442.orderNumber, priority)
}

const demoReset: ModuleCli = { command: 'demo:reset', async run(rest) {
  const args = parseArgs(rest)
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await scopeFor(em, args)
  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx = commandContext(container, scope)
  await ensureAutoSupplyProposalToggle(em)
  await ensureAutoSupplyReplyToggle(em)
  for (const row of await em.find(SupplyCase, { ...scope, deletedAt: null })) row.deletedAt = new Date()
  for (const row of await em.find(SupplyMessage, { ...scope, deletedAt: null })) row.deletedAt = new Date()
  const orders = await findWithDecryption(em, SalesOrder, { ...scope, deletedAt: null, orderNumber: { $like: 'SO-441%' } }, { orderBy: { createdAt: 'desc' } }, scope)
  const active = orders.filter((row) => !['canceled', 'cancelled'].includes(row.status ?? ''))
  const cancelled = await resolveStatusEntryIdByValue(em, { ...scope, value: 'canceled' })
  if (active.length && !cancelled) throw new Error('[internal] Sales canceled status is unavailable.')
  for (const order of active) await commandBus.execute('sales.orders.update', { input: { id: order.id, statusEntryId: cancelled }, ctx })
  for (const reservation of await em.find(InventoryReservation, { ...scope, sourceType: 'order', sourceId: { $in: active.map((row) => row.id) }, status: 'active', deletedAt: null })) await commandBus.execute('wms.inventory.release', { input: { tenantId: scope.tenantId, organizationId: scope.organizationId, reservationId: reservation.id, reason: 'supplier_demo_reset', metadata: { source: 'supplier_demo_reset' } }, ctx })
  await em.flush()
  if (!setup.seedExamples) throw new Error('[internal] Supplier demo setup seed is unavailable.')
  await setup.seedExamples({ em, container, tenantId: scope.tenantId, organizationId: scope.organizationId })
  if (communicationChannelsSetup.seedDefaults) await communicationChannelsSetup.seedDefaults({ em, container, tenantId: scope.tenantId, organizationId: scope.organizationId })
  await restoreSlots(em, scope, slotPriority(args))
  console.log(`[internal] Supplier demo reset completed for ${scope.tenantId}/${scope.organizationId}.`)
} }

const demoPreflight: ModuleCli = { command: 'demo:preflight', async run(rest) {
  const args = parseArgs(rest)
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await scopeFor(em, args)
  const failures: Array<[string, string]> = []
  const warnings: Array<[string, string]> = []
  const fail = (item: string, remediation: string) => failures.push([item, remediation])
  const warn = (item: string, remediation: string) => warnings.push([item, remediation])
  if (!await isAutoSupplyProposalEnabled(container, scope.tenantId)) fail(supplierDemoToggleId, 'run demo:reset')
  if (!await isAutoSupplyReplyEnabled(container, scope.tenantId)) fail(supplierDemoReplyToggleId, 'run demo:reset')
  const featureToggles = container.resolve('featureTogglesService') as { getBoolConfig: (id: string, tenantId: string) => Promise<{ ok: boolean; value?: boolean }> }
  const wms = await featureToggles.getBoolConfig('wms_integration_sales_order_inventory', scope.tenantId)
  if (!wms.ok || wms.value !== true) fail('wms_integration_sales_order_inventory', 'enable the WMS reservation toggle, then run demo:reset')
  try {
    const channel = await resolveMailboxPollChannel({ em, expectedScope: scope })
    if (!channel.isActive || !['connected', 'error'].includes(channel.status)) fail('mailbox channel connected', 'reconnect the Supplier mailbox channel')
    if (!channel.capabilities || typeof channel.capabilities !== 'object' || (channel.capabilities as { realtimePush?: unknown }).realtimePush !== false) fail('mailbox channel polling enabled', 'reconnect the Supplier mailbox with polling enabled')
    const row = await em.findOne(CommunicationChannel, { id: channel.id })
    if (!row?.pollIntervalSeconds || row.pollIntervalSeconds > 15) warn('mailbox poll interval <= 15 seconds', 'reconnect the Supplier mailbox with pollIntervalSeconds: 15')
  } catch (error) { fail(`mailbox:${error instanceof Error ? error.message : 'not_configured'}`, 'configure the Supplier mailbox and reconnect it') }
  if (!(container as { hasRegistration?: (name: string) => boolean }).hasRegistration?.('schedulerService')) fail('scheduler module enabled', 'activate @open-mercato/scheduler and restart the app')
  else if (!await em.findOne(ScheduledJob, { ...scope, targetQueue: COMMUNICATION_CHANNELS_QUEUES.pollTick, sourceModule: 'communication_channels', deletedAt: null })) fail('communication channels poll tick enabled', 'run demo:reset')
  if (!process.env.SCHEDULER_POLL_INTERVAL_MS) warn('SCHEDULER_POLL_INTERVAL_MS', 'set SCHEDULER_POLL_INTERVAL_MS=5000')
  if (!process.env.OM_HUB_POLL_SCHEDULER_TICK_SECONDS) warn('OM_HUB_POLL_SCHEDULER_TICK_SECONDS', 'set OM_HUB_POLL_SCHEDULER_TICK_SECONDS=10')
  // The scheduler process cannot be detected from here; the final "passed" line reminds the operator instead of a permanent WARN.
  // The hub seeds a fake test-seed mail channel when these two are set, which must never happen on the demo tenant.
  if (['1', 'true'].includes((process.env.OM_ENABLE_TEST_CHANNEL_SEEDING ?? '').trim().toLowerCase()) && process.env.SYSTEM_EMAIL_PROVIDER === 'test-seed') {
    fail('OM_ENABLE_TEST_CHANNEL_SEEDING', 'unset OM_ENABLE_TEST_CHANNEL_SEEDING (or SYSTEM_EMAIL_PROVIDER=test-seed) before demo:reset')
  }
  const manufacturer = (await findWithDecryption(em, CustomerEntity, { ...scope, deletedAt: null }, undefined, scope)).find((row) => row.displayName === 'Manufacturer A')
  if (!manufacturer) fail('Manufacturer A', 'run demo:reset')
  else if (!resolveSupplyRecipient({ customer: { primaryEmail: manufacturer.primaryEmail } }).ok) fail('partner_allowlist', 'set SUPPLIER_DEMO_PARTNER_EMAILS and run demo:reset')
  const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null })
  const warehouse = await em.findOne(Warehouse, { ...scope, code: 'SUPPLIER-DEMO', deletedAt: null })
  const location = warehouse ? await em.findOne(WarehouseLocation, { ...scope, warehouse, code: 'STOCK', deletedAt: null }) : null
  const balance = variant && warehouse && location ? await em.findOne(InventoryBalance, { ...scope, catalogVariantId: variant.id, warehouse, location, lot: null, serialNumber: null, deletedAt: null }) : null
  if (!variant) fail('MAT-42', 'run demo:reset')
  if (!warehouse || !location) fail('SUPPLIER-DEMO warehouse/location', 'run demo:reset')
  if (!balance || Number(balance.quantityOnHand) !== 1000 || Number(balance.quantityReserved) !== 0 || Number(balance.quantityAllocated) !== 0) fail('MAT-42 stock', 'run demo:reset')
  if (variant && await em.count(InventoryReservation, { ...scope, catalogVariantId: variant.id, status: 'active', deletedAt: null })) fail('MAT-42 has no active reservations', 'run demo:reset')
  const order = (await findWithDecryption(em, SalesOrder, { ...scope, deletedAt: null, orderNumber: { $like: 'SO-441%' } }, { orderBy: { createdAt: 'desc' } }, scope)).find((row) => !['canceled', 'cancelled'].includes(row.status ?? ''))
  if (!order || order.status !== 'draft') fail('draft SO-441', 'run demo:reset')
  if (order && warehouse && !await em.findOne(SalesOrderWarehouseAssignment, { ...scope, salesOrderId: order.id, warehouse })) fail('SO-441 warehouse assignment', 'run demo:reset')
  if (order && await em.findOne(SupplyCase, { ...scope, salesOrderId: order.id, deletedAt: null })) fail('SO-441 has no active SupplyCase', 'run demo:reset')
  for (const map of supplierDemoEncryptionMaps) {
    const row = await em.findOne(EncryptionMap, { entityId: map.entityId, ...scope, isActive: true, deletedAt: null })
    const configured = new Set((row?.fieldsJson ?? []).map((field) => field.field))
    if (!map.fields.every((field) => configured.has(field.field))) fail(`encryption map ${map.entityId}`, 'run demo:reset')
  }
  console.log(`[internal] queue strategy: ${process.env.QUEUE_STRATEGY ?? process.env.OM_QUEUE_STRATEGY ?? 'configured by app'}`)
  for (const [item, remediation] of warnings) console.warn(`[internal] Preflight warning: ${item}. Remediation: ${remediation}.`)
  for (const [item, remediation] of failures) console.error(`[internal] Preflight failed: ${item}. Remediation: ${remediation}.`)
  if (failures.length) throw new Error('[internal] Supplier demo preflight failed.')
  console.log('[internal] Supplier demo preflight passed. Ensure the scheduler process is running when it is not auto-spawned.')
} }

const demoCase: ModuleCli = { command: 'demo:case', async run(rest) {
  const args = parseArgs(rest)
  if (!args.correlation) throw new Error('[internal] Usage: demo:case --correlation SC-SO-441')
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await scopeFor(em, args)
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { ...scope, correlationId: args.correlation, deletedAt: null }, undefined, scope)
  if (!supplyCase) throw new Error('[internal] Supply case not found.')
  const messages = await findWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, deletedAt: null }, { orderBy: { createdAt: 'asc' } }, scope)
  console.log(JSON.stringify({ case: supplyCase, messages }, null, 2))
} }

function simulatedEnvelope(type: string, supplyCase: SupplyCase, proposal: SupplyMessage, sender: string, acceptedQuantity: number): SupplyEnvelope | string {
  if (type === 'malformed') return '{ not valid json'
  const [first, ...later] = supplyCase.currentCommitment
  const date = first?.date ?? new Date().toISOString().slice(0, 10)
  const accepted = [{ quantity: acceptedQuantity, date }]
  // The remainder of every proposed tranche is cancelled on its own date, so F3 (per-date balance) holds by construction.
  const cancelled = [
    ...(first && first.quantity > acceptedQuantity ? [{ quantity: first.quantity - acceptedQuantity, date: first.date }] : []),
    ...later.map((entry) => ({ quantity: entry.quantity, date: entry.date })),
  ].filter((entry) => entry.quantity > 0)
  // The reply is addressed to the Supplier mailbox the proposal came from.
  const recipient = proposal.senderEmail ?? process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ?? ''
  const base = { schemaVersion: 1 as const, messageId: `MSG-${randomUUID()}`, correlationId: supplyCase.correlationId, sender, recipient }
  if (type === 'counter') return { ...base, messageType: 'SUPPLY_COUNTER_PROPOSAL', payload: { sku: supplyCase.sku, inReplyToMessageId: proposal.businessMessageId, requestedCommitments: accepted } }
  if (type === 'rejection') return { ...base, messageType: 'SUPPLY_REJECTION', payload: { sku: supplyCase.sku, inReplyToMessageId: proposal.businessMessageId, reason: 'Rejected by manufacturer' } }
  return { ...base, messageType: 'SUPPLY_ACCEPTANCE', payload: { sku: supplyCase.sku, inReplyToMessageId: proposal.businessMessageId, acceptedCommitments: accepted, cancelledCommitments: cancelled } }
}

const simulateReply: ModuleCli = { command: 'mail:simulate-reply', async run(rest) {
  const args = parseArgs(rest)
  const type = args.type ?? 'acceptance'
  const replyTypes = ['acceptance', 'counter', 'rejection', 'malformed', 'wrong-sender', 'stale']
  if (!replyTypes.includes(type)) {
    throw new Error(`[internal] --type must be one of: ${replyTypes.join(', ')}. Example: mail:simulate-reply --type counter --accept 400 --inject`)
  }
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await scopeFor(em, args)
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { ...scope, deletedAt: null, ...(args.correlation ? { correlationId: args.correlation } : {}) }, { orderBy: { updatedAt: 'desc' } }, scope)
  if (!supplyCase) throw new Error('[internal] No live supply case exists.')
  const proposal = await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, direction: 'outbound', messageType: 'SUPPLY_PROPOSAL', deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope)
  if (!proposal) throw new Error('[internal] No proposal exists.')
  const partner = supplyCase.recipientEmail ?? process.env.SUPPLIER_DEMO_PARTNER_EMAILS?.split(',')[0]?.trim() ?? 'manufacturer-a@example.test'
  const sender = type === 'wrong-sender' ? 'spoof@example.test' : partner
  const envelope = simulatedEnvelope(type === 'stale' ? 'acceptance' : type, supplyCase, type === 'stale' ? { ...proposal, businessMessageId: 'MSG-stale' } : proposal, sender, Number(args.accept ?? supplyCase.currentCommitment[0]?.quantity ?? 1))
  const body = `Manufacturer reply.\n\n${typeof envelope === 'string' ? envelope : renderSupplyEnvelope(envelope)}`
  const parsed = parseInboundSupplyText(body)
  const candidate = parsed.blocks.length === 1 ? parsed.blocks[0]?.envelope ?? null : null
  const status = validateInboundEnvelope({ envelope: candidate, blockCount: parsed.blocks.length, schemaError: parsed.blocks[0]?.schemaError, transportSender: sender, senderAllowlisted: resolveSupplyRecipient({ customer: { primaryEmail: sender } }).ok, casePartner: supplyCase.recipientEmail, transportRecipient: proposal.senderEmail ?? null, caseRecord: supplyCase, latestProposalId: proposal.businessMessageId }).status
  console.log(`${body}\n\n[internal] validator classification: ${status}`)
  if (args.inject !== undefined) {
    const injectionAllowed = ['1', 'true'].includes((process.env.SUPPLIER_DEMO_ALLOW_REPLY_INJECTION ?? '').trim().toLowerCase())
    if (process.env.NODE_ENV === 'production' || !injectionAllowed) throw new Error('[internal] Reply injection is disabled; set SUPPLIER_DEMO_ALLOW_REPLY_INJECTION=true in development.')
    const channel = await resolveMailboxPollChannel({ em, expectedScope: scope })
    const commandBus = container.resolve('commandBus') as CommandBus
    // A synthetic RFC Message-ID lets the confirmation reply carry In-Reply-To/References like a real mail.
    const rfcMessageId = `sim-${randomUUID()}@supplier-demo.local`
    await commandBus.execute('communication_channels.message.ingest_inbound', { input: { channelId: channel.id, providerKey: 'imap', channelType: 'email', scope, message: { externalMessageId: rfcMessageId, externalConversationId: `sim-thread-${supplyCase.id}`, senderIdentifier: sender, subject: `Re: [${supplyCase.correlationId}] Delivery update — ${supplyCase.sku}`, body, bodyFormat: 'text', timestamp: new Date(), channelPayload: { from: sender, to: proposal.senderEmail ?? process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ?? '', messageId: rfcMessageId }, channelContentType: 'text/plain', channelMetadata: { messageId: rfcMessageId } } }, ctx: commandContext(container, scope) })
    console.log('[internal] Reply injected through communication_channels.message.ingest_inbound.')
  }
} }

function runInboundSelftest(): void {
  const caseRecord = { status: 'proposal_delivered' as const, correlationId: 'SC-SO-441', sku: 'MAT-42' }
  const makeAcceptance = (messageId: string, inReplyToMessageId = 'PROPOSAL-1'): SupplyEnvelope => ({ schemaVersion: 1, messageId, correlationId: caseRecord.correlationId, messageType: 'SUPPLY_ACCEPTANCE', sender: 'manufacturer@example.test', recipient: 'supplier@example.test', payload: { sku: caseRecord.sku, inReplyToMessageId, acceptedCommitments: [{ quantity: 300, date: '2026-09-23' }], cancelledCommitments: [] } })
  const classify = (envelope: SupplyEnvelope | null, blockCount = 1, overrides: Partial<Parameters<typeof validateInboundEnvelope>[0]> = {}) => validateInboundEnvelope({ envelope, blockCount, transportSender: 'manufacturer@example.test', senderAllowlisted: true, casePartner: 'manufacturer@example.test', caseRecord, latestProposalId: 'PROPOSAL-1', ...overrides }).status
  // [scenario, actual status, expected status]
  const matrix: Array<[string, string, string]> = [
    ['valid acceptance', classify(makeAcceptance('ACCEPT-1')), 'valid'],
    ['duplicate', classify(makeAcceptance('ACCEPT-1'), 1, { validBusinessMessageIds: new Set(['ACCEPT-1']) }), 'duplicate'],
    ['squatting first attempt', classify({ ...makeAcceptance('SQUAT-1'), correlationId: 'SC-OTHER' }), 'correlation_mismatch'],
    // Invalid rows never reserve an id, so the valid retry with the same messageId is still accepted.
    ['squatting valid retry', classify(makeAcceptance('SQUAT-1'), 1, { validBusinessMessageIds: new Set(['ACCEPT-1']) }), 'valid'],
    ['counter', classify({ ...makeAcceptance('COUNTER-1'), messageType: 'SUPPLY_COUNTER_PROPOSAL', payload: { sku: caseRecord.sku, inReplyToMessageId: 'PROPOSAL-1', requestedCommitments: [{ quantity: 250, date: '2026-09-23' }] } }), 'valid'],
    ['rejection', classify({ ...makeAcceptance('REJECT-1'), messageType: 'SUPPLY_REJECTION', payload: { sku: caseRecord.sku, inReplyToMessageId: 'PROPOSAL-1', reason: 'No capacity' } }), 'valid'],
    ['non-allowlisted sender', classify(makeAcceptance('UNTRUSTED-1'), 1, { transportSender: 'spoof@example.test', senderAllowlisted: false }), 'untrusted_sender'],
    ['allowlisted non-partner', classify(makeAcceptance('OTHER-1'), 1, { transportSender: 'other-partner@example.test' }), 'sender_not_case_partner'],
    ['stale reference', classify(makeAcceptance('STALE-1', 'PROPOSAL-OLD')), 'stale_reference'],
    ['ambiguous blocks', classify(makeAcceptance('AMBIGUOUS-1'), 2), 'ambiguous_envelope'],
    ['late reply', classify(makeAcceptance('LATE-1'), 1, { caseRecord: { ...caseRecord, status: 'resolved' } }), 'case_closed'],
  ]
  const mismatches = matrix.filter(([, actual, expected]) => actual !== expected)
  if (mismatches.length) {
    throw new Error(`[internal] inbound selftest failed: ${mismatches.map(([scenario, actual, expected]) => `${scenario} → ${actual} (expected ${expected})`).join('; ')}`)
  }
  const malformed = parseInboundSupplyText('---OPEN-MERCATO-SUPPLY-MESSAGE---{bad---END-OPEN-MERCATO-SUPPLY-MESSAGE---')
  if (malformed.blocks[0]?.schemaError !== 'invalid_json') throw new Error('[internal] inbound selftest malformed envelope classification failed.')
  console.log(`[internal] inbound selftest matrix passed (${matrix.length} validation scenarios + malformed block). Note: pure validation only, not the database path.`)
}

function runLoopSelftest(): void {
  const proposed = [{ quantity: 400, date: '2026-09-23' }, { quantity: 100, date: '2026-09-25' }]
  const slots = [{ date: '2026-09-23', capacityQuantity: 400, allocatedQuantity: 0 }, { date: '2026-09-25', capacityQuantity: 400, allocatedQuantity: 300 }]
  const feasible = evaluateFeasibility({ proposed, accepted: [{ quantity: 400, date: '2026-09-23' }], cancelled: [{ quantity: 100, date: '2026-09-25' }], originalDate: '2026-09-23', warehouseReserved: 300, slots })
  if (!feasible.ok || feasible.production[0]?.quantity !== 100 || feasible.freedCapacity[0]?.quantity !== 100) throw new Error('[internal] loop selftest feasibility failed.')
  const infeasible = evaluateFeasibility({ proposed, accepted: [{ quantity: 450, date: '2026-09-23' }], cancelled: [{ quantity: 50, date: '2026-09-25' }], originalDate: '2026-09-23', warehouseReserved: 300, slots })
  if (infeasible.ok || infeasible.rule !== 'F3') throw new Error('[internal] loop selftest infeasible acceptance was not rejected by F3.')
  console.log('[internal] loop selftest passed: feasibility (accept 400 / cancel 100, production 100, freed 100) and F3 rejection. Note: pure feasibility only, not the database path.')
}

const selftest: ModuleCli = { command: 'demo:selftest', async run(rest) {
  const args = parseArgs(rest)
  const scenario = args.scenario ?? 'mailbox-poll'
  if (!['mailbox-poll', 'inbound-all', 'loop-all', 'all'].includes(scenario)) throw new Error('[internal] Unknown supplier demo selftest scenario.')
  if (scenario === 'inbound-all' || scenario === 'all') runInboundSelftest()
  if (scenario === 'loop-all' || scenario === 'all') runLoopSelftest()
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await scopeFor(em, args)
  let enqueued = 0
  const result = await requestMailboxPoll(em, scope, { dependencies: { enqueue: async () => { enqueued += 1 }, now: () => new Date('2026-01-01T00:00:00.000Z') } })
  if (!result.queued || enqueued !== 1) throw new Error('[internal] mailbox-poll selftest expected exactly one poll job.')
  console.log(`[internal] demo:selftest --scenario ${scenario} passed (${scenario === 'inbound-all' || scenario === 'all' ? 'inbound matrix, ' : ''}${scenario === 'loop-all' || scenario === 'all' ? 'loop matrix, ' : ''}mailbox poll queued exactly once).`)
} }

const mailSmoke: ModuleCli = { command: 'mail:smoke', async run(rest) {
  const parsed = z.object({ to: z.string().email() }).safeParse({ to: parseArgs(rest).to })
  if (!parsed.success) throw new Error('[internal] Usage: mail:smoke --to <addr>')
  const result = await sendSupplyMail(await createRequestContainer(), { to: parsed.data.to, subject: 'Supplier mailbox smoke test', body: 'Supplier mailbox smoke test: the Communication Channels outbound path is active.' })
  console.log(`Supplier mailbox smoke message queued: ${result.messageId}`)
} }

export default [mailSmoke, demoReset, demoPreflight, demoCase, simulateReply, selftest]
