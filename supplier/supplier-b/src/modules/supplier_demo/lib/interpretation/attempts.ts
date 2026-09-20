import { createHash, randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SupplyCase, SupplyMessage } from '../../data/entities'
import { SUPPLIER_REPLY_INTERPRETER_PROMPT_VERSION } from '../../ai-agents'
import type { ReplyInterpreterConfig } from './config'
import { createInterpretationRecord, parseInterpretationRecord, type InterpretationAttempt, type InterpretationRecord, type InterpretationUsage } from './record'

export type InterpretationScope = { tenantId: string; organizationId: string }

export type InterpretationClaimResult =
  | { kind: 'claimed'; attempt: InterpretationAttempt; inputHash: string }
  | { kind: 'in_progress'; runId: string; leaseExpiresAt: string }
  | { kind: 'completed'; reason: string }
  | { kind: 'skipped'; reason: string }

const LEASE_MARGIN_MS = 30_000
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000

function advisoryKey(tenantId: string): string {
  return `supplier_demo.reply_interpreter:${tenantId}`
}

async function lockTenant(tx: EntityManager, tenantId: string): Promise<void> {
  await tx.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [advisoryKey(tenantId)])
}

function zeroUsage(): InterpretationUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: null, known: false, partial: true }
}

function activeAttempt(record: InterpretationRecord): InterpretationAttempt | null {
  return record.attempts.find((attempt) => attempt.finishedAt === null) ?? null
}

// The cap is per case, not per mail: several free-text replies on one case share the same budget.
async function caseAttemptCount(tx: EntityManager, scope: InterpretationScope, caseId: string): Promise<number> {
  const messages = await findWithDecryption(tx, SupplyMessage, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    supplyCaseId: caseId,
    direction: 'inbound',
    interpretationRecord: { $ne: null },
    deletedAt: null,
  }, { limit: 200 }, scope)
  return messages.reduce((total, message) => {
    if (!message.interpretationRecord) return total
    return total + parseInterpretationRecord(message.interpretationRecord).attempts.length
  }, 0)
}

async function dailyCount(tx: EntityManager, scope: InterpretationScope, now: Date): Promise<number> {
  const since = now.getTime() - DAILY_WINDOW_MS
  // Only mails that actually carry a record can hold an attempt; the newest ones are the only ones inside the
  // rolling window, so the scan stays bounded on a busy tenant.
  const messages = await findWithDecryption(tx, SupplyMessage, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    direction: 'inbound',
    interpretationRecord: { $ne: null },
    deletedAt: null,
  }, { orderBy: { createdAt: 'desc' }, limit: 500 }, scope)
  return messages.reduce((total, message) => {
    if (!message.interpretationRecord) return total
    const record = parseInterpretationRecord(message.interpretationRecord)
    return total + record.attempts.filter((attempt) => new Date(attempt.startedAt).getTime() >= since).length
  }, 0)
}

function buildAttempt(input: {
  record: InterpretationRecord
  config: ReplyInterpreterConfig
  input: Record<string, unknown>
  now: Date
}): InterpretationAttempt {
  const runId = randomUUID()
  const serialized = JSON.stringify(input.input)
  return {
    attemptNo: input.record.attempts.length + 1,
    runId,
    startedAt: input.now.toISOString(),
    leaseExpiresAt: new Date(input.now.getTime() + input.config.timeoutMs + LEASE_MARGIN_MS).toISOString(),
    finishedAt: null,
    latencyMs: null,
    configuredProvider: input.config.provider,
    configuredModel: input.config.model,
    effectiveProvider: null,
    effectiveModel: null,
    promptVersion: SUPPLIER_REPLY_INTERPRETER_PROMPT_VERSION,
    systemPromptHash: null,
    inputHash: createHash('sha256').update(serialized).digest('hex'),
    modelInput: input.input,
    usage: zeroUsage(),
    providerRequestCount: 0,
    outcome: null,
    errorCode: null,
    output: null,
    auditState: 'claimed',
  }
}

export async function claimReplyInterpretationAttempt(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  supplyMessageId: string
  config: ReplyInterpreterConfig
  modelInput: Record<string, unknown>
  attemptNo: number
  sanitizer?: InterpretationRecord['sanitizer']
  now?: Date
}): Promise<InterpretationClaimResult> {
  const now = input.now ?? new Date()
  return input.em.transactional(async (tx) => {
    await lockTenant(tx, input.scope.tenantId)
    const supplyCase = await findOneWithDecryption(tx, SupplyCase, { ...input.scope, id: input.caseId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, input.scope)
    const message = await findOneWithDecryption(tx, SupplyMessage, {
      ...input.scope,
      id: input.supplyMessageId,
      supplyCaseId: input.caseId,
      direction: 'inbound',
      deletedAt: null,
    }, undefined, input.scope)
    if (!supplyCase || !message) return { kind: 'skipped', reason: 'interpretation_not_found' }
    const record = message.interpretationRecord
      ? parseInterpretationRecord(message.interpretationRecord)
      : createInterpretationRecord({ eligible: true, reason: 'freeform_reply' })
    const active = activeAttempt(record)
    if (active) return { kind: 'in_progress', runId: active.runId, leaseExpiresAt: active.leaseExpiresAt }
    if (input.attemptNo !== record.attempts.length + 1) return { kind: 'completed', reason: 'attempt_fenced' }
    if (await caseAttemptCount(tx, input.scope, input.caseId) >= input.config.maxAttemptsPerCase) {
      record.outcome = 'cap_reached'
      message.interpretationRecord = record
      await tx.flush()
      return { kind: 'skipped', reason: 'interpretation_cap_reached' }
    }
    if (await dailyCount(tx, input.scope, now) >= input.config.maxAttemptsPerDay) {
      record.outcome = 'cap_reached'
      message.interpretationRecord = record
      await tx.flush()
      return { kind: 'skipped', reason: 'interpretation_cap_reached' }
    }
    const attempt = buildAttempt({ record, config: input.config, input: input.modelInput, now })
    record.attempts = [...record.attempts, attempt]
    // The audit keeps what the sanitizer actually produced for this attempt, not the zeroed defaults.
    if (input.sanitizer) record.sanitizer = input.sanitizer
    record.outcome = 'pending'
    message.interpretationRecord = record
    await tx.flush()
    return { kind: 'claimed', attempt, inputHash: attempt.inputHash }
  })
}

export async function markReplyInterpretationPrepared(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  supplyMessageId: string
  runId: string
  systemPromptHash: string
}): Promise<void> {
  await input.em.transactional(async (tx) => {
    await lockTenant(tx, input.scope.tenantId)
    const message = await findOneWithDecryption(tx, SupplyMessage, { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, deletedAt: null }, undefined, input.scope)
    if (!message?.interpretationRecord) return
    const record = parseInterpretationRecord(message.interpretationRecord)
    const attempt = record.attempts.find((candidate) => candidate.runId === input.runId)
    if (!attempt || attempt.finishedAt) return
    attempt.auditState = 'prepared'
    attempt.systemPromptHash = input.systemPromptHash
    message.interpretationRecord = record
    await tx.flush()
  })
}

function attemptOutcome(record: InterpretationRecord, outcome: InterpretationAttempt['outcome']): InterpretationRecord['outcome'] {
  if (outcome === 'ok') return 'display_only'
  if (outcome === 'invalid_output' || outcome === 'provider_error' || outcome === 'timeout' || outcome === 'rate_limited' || outcome === 'missing_config' || outcome === 'refusal' || outcome === 'principal_missing' || outcome === 'cancelled') return 'failed'
  return 'failed'
}

export async function finalizeReplyInterpretationAttempt(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  supplyMessageId: string
  runId: string
  result: {
    output: import('./reply-intent').ReplyIntent | null
    outcome: InterpretationAttempt['outcome']
    errorCode?: string | null
    usage?: Partial<InterpretationUsage>
    effectiveProvider?: string | null
    effectiveModel?: string | null
    providerRequestCount?: number
    systemPromptHash?: string | null
    intent?: import('./reply-intent').ReplyIntent | null
    checks?: InterpretationRecord['checks']
  }
  now?: Date
}): Promise<InterpretationAttempt> {
  const now = input.now ?? new Date()
  return input.em.transactional(async (tx) => {
    await lockTenant(tx, input.scope.tenantId)
    const message = await findOneWithDecryption(tx, SupplyMessage, { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, deletedAt: null }, undefined, input.scope)
    if (!message?.interpretationRecord) throw new Error('[internal] Interpretation record not found.')
    const record = parseInterpretationRecord(message.interpretationRecord)
    const attempt = record.attempts.find((candidate) => candidate.runId === input.runId)
    if (!attempt) throw new Error('[internal] Interpretation attempt not found.')
    if (attempt.finishedAt) return attempt
    attempt.finishedAt = now.toISOString()
    attempt.latencyMs = Math.max(0, now.getTime() - new Date(attempt.startedAt).getTime())
    attempt.auditState = input.result.outcome === 'ok' ? 'complete' : 'incomplete'
    attempt.effectiveProvider = input.result.effectiveProvider ?? attempt.effectiveProvider
    attempt.effectiveModel = input.result.effectiveModel ?? attempt.effectiveModel
    attempt.systemPromptHash = input.result.systemPromptHash ?? attempt.systemPromptHash
    attempt.providerRequestCount = input.result.providerRequestCount ?? 0
    attempt.outcome = input.result.outcome
    attempt.errorCode = input.result.errorCode ?? null
    attempt.output = input.result.output
    attempt.usage = {
      inputTokens: input.result.usage?.inputTokens ?? 0,
      outputTokens: input.result.usage?.outputTokens ?? 0,
      reasoningTokens: input.result.usage?.reasoningTokens ?? null,
      known: input.result.usage?.inputTokens !== undefined || input.result.usage?.outputTokens !== undefined,
      partial: input.result.usage?.inputTokens === undefined || input.result.usage?.outputTokens === undefined,
    }
    record.intent = input.result.intent ?? null
    record.checks = input.result.checks ?? record.checks
    record.outcome = attemptOutcome(record, input.result.outcome)
    message.interpretationRecord = record
    await tx.flush()
    return attempt
  })
}

export async function recoverExpiredReplyInterpretation(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  supplyMessageId: string
  now?: Date
}): Promise<boolean> {
  const now = input.now ?? new Date()
  return input.em.transactional(async (tx) => {
    await lockTenant(tx, input.scope.tenantId)
    const message = await findOneWithDecryption(tx, SupplyMessage, { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, deletedAt: null }, undefined, input.scope)
    if (!message?.interpretationRecord) return false
    const record = parseInterpretationRecord(message.interpretationRecord)
    const attempt = activeAttempt(record)
    if (!attempt || new Date(attempt.leaseExpiresAt).getTime() > now.getTime()) return false
    attempt.finishedAt = now.toISOString()
    attempt.latencyMs = Math.max(0, now.getTime() - new Date(attempt.startedAt).getTime())
    attempt.auditState = 'incomplete'
    attempt.outcome = 'timeout'
    attempt.errorCode = 'lease_expired'
    attempt.usage = zeroUsage()
    record.outcome = 'failed'
    message.interpretationRecord = record
    await tx.flush()
    return true
  })
}
