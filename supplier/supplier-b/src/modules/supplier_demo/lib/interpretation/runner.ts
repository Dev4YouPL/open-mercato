import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { generateObject } from 'ai'
import {
  runAiAgentObject,
  type RunAiAgentObjectInput,
  type RunAiAgentObjectResult,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { SupplyCase, SupplyMessage, SupplierProductionSlot } from '../../data/entities'
import {
  SUPPLIER_REPLY_INTERPRETER_AGENT_ID,
  SUPPLIER_REPLY_INTERPRETER_SYSTEM_PROMPT,
  supplierReplyInterpreterOutputSchema,
} from '../../ai-agents'
import { validateReplyIntent, type ReplyIntent } from './reply-intent'
import { preScanReplyText } from './prescan'
import { sanitizeReplyText } from './sanitize'
import { buildReplyInterpreterInput, canonicalReplyInterpreterInput, hashReplyInterpreterInput, SUPPLIER_REPLY_INTERPRETER_PROMPT_VERSION } from './input'
import { parseReplyInterpreterConfig, type ReplyInterpreterConfig } from './config'
import {
  claimReplyInterpretationAttempt,
  finalizeReplyInterpretationAttempt,
  markReplyInterpretationPrepared,
  type InterpretationScope,
} from './attempts'
import { reportSupplierAttemptUsage, reportSupplierUsageError } from '../agent/usage'
import { createInterpretationRecord, parseInterpretationRecord, type InterpretationAttempt } from './record'
import { createNegotiationRecord } from '../negotiation-record'
import { resolveReplyIntent, type ReplyResolution } from './resolve'

const logger = createLogger('supplier_demo').child({ component: 'reply-interpreter' })

// Intents the model may label when the mail names quantities. The first two are counter-proposals by definition;
// the acceptances only become one when the resolved split keeps the ordered total (see materializeDerivedCounter).
const NEGOTIABLE_INTENTS = new Set<ReplyIntent['kind']>(['counter_split', 'partial_with_remainder'])
const INTENTS_WITH_A_SPLIT = new Set<ReplyIntent['kind']>([...NEGOTIABLE_INTENTS, 'accept_all', 'accept_partial'])

type InterpreterResult = RunAiAgentObjectResult<ReplyIntent>
type InterpreterRunner = (input: RunAiAgentObjectInput<ReplyIntent>) => Promise<InterpreterResult>

type EffectiveCall = { provider: string | null; model: string | null }

function errorStatus(error: unknown): number | null {
  const candidate = error as { statusCode?: unknown; status?: unknown } | null
  const value = candidate?.statusCode ?? candidate?.status
  return typeof value === 'number' ? value : null
}

function classifyFailure(error: unknown): NonNullable<InterpretationAttempt['outcome']> {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (name === 'AbortError' || name === 'TimeoutError' || message.includes('deadline')) return 'timeout'
  if (errorStatus(error) === 429) return 'rate_limited'
  if (message.includes('api key') || name === 'AiModelFactoryError') return 'missing_config'
  if (message.includes('refus') || message.includes('content filter')) return 'refusal'
  return 'provider_error'
}

function retryable(error: unknown): boolean {
  const status = errorStatus(error)
  return status === 429 || status === 502 || status === 503
}

// Operator-safe description of a failed call. The provider's own body matters here: OpenRouter answers a rejected
// upstream request with the generic "Provider returned error", and only the body says what was actually wrong.
function describeInterpreterError(error: unknown): { name: string; status: number | null; message: string } {
  const name = error instanceof Error ? error.name : typeof error
  const cause = (error as { cause?: unknown } | null)?.cause
  const body = (error as { responseBody?: unknown; data?: unknown } | null)?.responseBody
    ?? (error as { data?: unknown } | null)?.data
  const raw = [
    error instanceof Error ? error.message : String(error),
    cause instanceof Error ? `cause: ${cause.message}` : '',
    body ? `response: ${typeof body === 'string' ? body : JSON.stringify(body)}` : '',
  ].filter(Boolean).join(' | ')
  return {
    name,
    status: errorStatus(error),
    message: raw.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]').slice(0, 1000),
  }
}

function languageHint(text: string): 'pl' | 'en' | null {
  if (/[ąćęłńóśźż]/i.test(text)) return 'pl'
  if (/\b(?:the|we|can|please|send|take|original|remainder)\b/i.test(text)) return 'en'
  return null
}

function dayExpression(date: string): string {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? 'mon'
}

function inputForCase(supplyCase: SupplyCase, sanitizedText: string): Record<string, unknown> {
  return buildReplyInterpreterInput({
    supplyCase,
    sanitizedText,
    languageHint: languageHint(sanitizedText),
    today: new Date().toISOString().slice(0, 10),
  })
}

export function buildReplyInterpreterRuntimeRequest(input: {
  serializedInput: string
  config: ReplyInterpreterConfig
  container?: AwilixContainer
  runId: string
  scope: InterpretationScope
  effective: EffectiveCall
}): RunAiAgentObjectInput<ReplyIntent> {
  return {
    agentId: SUPPLIER_REPLY_INTERPRETER_AGENT_ID,
    input: input.serializedInput,
    authContext: {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      userId: 'supplier-demo-system',
      features: ['supplier_demo.supply_cases.manage'],
      isSuperAdmin: false,
    },
    providerOverride: input.config.provider,
    modelOverride: input.config.model,
    container: input.container,
    sessionId: input.runId,
    enableTools: false,
    generateObject: async (options: Parameters<NonNullable<RunAiAgentObjectInput<ReplyIntent>['generateObject']>>[0]) => {
      const model = options.model as { provider?: unknown; modelId?: unknown }
      input.effective.provider = typeof model.provider === 'string' ? model.provider : null
      input.effective.model = typeof model.modelId === 'string' ? model.modelId : null
      const localAbort = new AbortController()
      const timeout = setTimeout(() => localAbort.abort(), input.config.timeoutMs)
      try {
        const abortSignal = typeof AbortSignal.any === 'function'
          ? AbortSignal.any([options.abortSignal ?? new AbortController().signal, localAbort.signal])
          : localAbort.signal
        let request = 0
        while (true) {
          try {
            return await generateObject({
              ...options,
              schema: options.schema as never,
              maxOutputTokens: input.config.maxOutputTokens,
              maxRetries: 0,
              abortSignal,
            } as never)
          } catch (error) {
            request += 1
            if (request > 1 || !retryable(error)) throw error
          }
        }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

async function runWithDeadline(input: { runner: InterpreterRunner; request: RunAiAgentObjectInput<ReplyIntent>; timeoutMs: number }): Promise<InterpreterResult> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('[internal] reply interpreter deadline exceeded'), { code: 'supplier_interpreter_timeout' })), input.timeoutMs + 2_000)
  })
  try {
    return await Promise.race([input.runner(input.request), deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function storeBlockedInterpretation(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  supplyMessageId: string
  reason: string
  inputChars: number
  outputChars: number
  prescan: { hit: boolean; rules: string[] }
}): Promise<void> {
  await input.em.transactional(async (tx) => {
    const message = await findOneWithDecryption(tx, SupplyMessage, { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, deletedAt: null }, undefined, input.scope)
    if (!message) return
    const record = message.interpretationRecord
      ? parseInterpretationRecord(message.interpretationRecord)
      : createInterpretationRecord({ eligible: true, reason: 'freeform_reply' })
    record.sanitizer = { version: 's1', inputChars: input.inputChars, outputChars: input.outputChars, prescan: input.prescan }
    record.outcome = input.reason === 'interpretation_flagged' || input.reason === 'interpretation_blocked_suspicious_content' ? 'flagged' : 'blocked'
    record.checks = { schema: 'fail', consistency: input.reason, grounding: 'not_run', confidenceOk: false }
    message.interpretationRecord = record
    await tx.flush()
  })
}

async function reportUsage(input: { em: EntityManager; scope: InterpretationScope; attempt: InterpretationAttempt }): Promise<void> {
  try {
    await reportSupplierAttemptUsage({ em: input.em, scope: input.scope, agentId: SUPPLIER_REPLY_INTERPRETER_AGENT_ID, attempt: input.attempt })
  } catch (error) {
    reportSupplierUsageError(error, input.attempt.runId)
  }
}

async function materializeDerivedCounter(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  sourceMessageId: string
  intent: ReplyIntent
  today: string
}): Promise<{ counterId: string; resolution: ReplyResolution } | null> {
  // The model's label alone does not decide this. A buyer who writes "we'll take 400 on Wednesday and the other
  // 100 on Saturday" is proposing a different split even though it reads as a partial acceptance, so any intent
  // that names quantities is resolved and then judged by the numbers: the same total on different dates is a
  // counter-proposal, anything else stays display-only.
  if (!INTENTS_WITH_A_SPLIT.has(input.intent.kind)) return null
  if (!input.intent.tranches.some((tranche) => tranche.quantity !== null || tranche.quantityIsRemainder)) return null
  const strictTotals = !NEGOTIABLE_INTENTS.has(input.intent.kind)
  const result = await input.em.transactional(async (tx) => {
    const supplyCase = await findOneWithDecryption(tx, SupplyCase, { ...input.scope, id: input.caseId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, input.scope)
    const source = await findOneWithDecryption(tx, SupplyMessage, { ...input.scope, id: input.sourceMessageId, supplyCaseId: input.caseId, direction: 'inbound', deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, input.scope)
    if (!supplyCase || !source || !['proposal_queued', 'proposal_delivered'].includes(supplyCase.status)) return null
    const slots = await tx.find(SupplierProductionSlot, { ...input.scope, catalogVariantId: supplyCase.catalogVariantId, deletedAt: null }, { orderBy: { startsAt: 'asc' } })
    const resolved = resolveReplyIntent({
      intent: input.intent,
      today: input.today,
      currentCommitment: supplyCase.currentCommitment,
      originalCommitment: supplyCase.originalCommitment,
      slots,
      caseOrderNumber: supplyCase.orderNumber,
    })
    // An intent the model labelled as an acceptance only becomes a counter when the split resolves cleanly and
    // keeps the ordered total; a partial acceptance that drops quantity is not a counter and stays display-only.
    if (strictTotals && !resolved.ok) return null
    const commitments = resolved.ok ? resolved.commitments : resolved.resolution?.tranches.map(({ quantity, date }) => ({ quantity, date })) ?? []
    if (!commitments.length || !resolved.resolution) return null
    // A plain "we accept" restates our own proposal. That is not a counter, so the case keeps waiting for the
    // partner's structured acceptance instead of being pulled into a negotiation round that changes nothing.
    const asKey = (entries: Array<{ quantity: number; date: string }>) => entries
      .map((entry) => `${entry.date}:${entry.quantity}`).sort().join('|')
    if (asKey(commitments) === asKey(supplyCase.currentCommitment)) return null
    const counterId = randomUUID()
    const businessMessageId = `INT-${input.sourceMessageId}`
    const now = new Date()
    const counter = tx.create(SupplyMessage, {
      id: counterId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      supplyCaseId: input.caseId,
      businessMessageId,
      direction: 'inbound',
      messageType: 'SUPPLY_COUNTER_PROPOSAL',
      validationStatus: 'interpreted',
      validationReason: resolved.ok ? 'interpreted_freeform_reply' : resolved.code,
      inReplyToBusinessId: source.businessMessageId,
      // The revision is threaded against this row, so it has to carry the transport identity of the mail it stands
      // for. `hubChannelLinkId` is deliberately left null: it is unique per inbound mail and belongs to the source.
      rfcMessageId: source.rfcMessageId ?? null,
      hubMessageId: source.hubMessageId ?? null,
      receivedAt: source.receivedAt ?? now,
      senderEmail: source.senderEmail,
      recipientEmail: source.recipientEmail,
      subject: source.subject,
      bodyExcerpt: null,
      envelopePayload: {
        schemaVersion: 1,
        messageId: businessMessageId,
        correlationId: supplyCase.correlationId,
        messageType: 'SUPPLY_COUNTER_PROPOSAL',
        origin: 'interpretation',
        sourceSupplyMessageId: source.id,
        payload: { sku: supplyCase.sku, inReplyToMessageId: source.businessMessageId, requestedCommitments: commitments },
      },
      deliveryStatus: 'delivered',
      duplicateCount: 0,
      attempts: 0,
      negotiationRecord: createNegotiationRecord(),
      createdAt: now,
      updatedAt: now,
    })
    source.interpretationRecord = {
      ...(source.interpretationRecord ? parseInterpretationRecord(source.interpretationRecord) : createInterpretationRecord({ eligible: true, reason: 'freeform_reply' })),
      resolution: resolved.resolution,
      outcome: 'counter_created',
      derivedCounterMessageId: counterId,
    }
    supplyCase.status = 'counter_received'
    supplyCase.statusReason = null
    supplyCase.updatedAt = now
    tx.persist(counter)
    await tx.flush()
    return { counterId, resolution: resolved.resolution }
  })
  return result
}

export async function runSupplierReplyInterpretation(input: {
  em: EntityManager
  scope: InterpretationScope
  caseId: string
  supplyMessageId: string
  attemptNo: number
  container?: AwilixContainer
  config?: ReplyInterpreterConfig
  runObject?: InterpreterRunner
}): Promise<{ status: string; reason: string; runId?: string; counterId?: string }> {
  const em = input.em.fork()
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { ...input.scope, id: input.caseId, deletedAt: null }, undefined, input.scope)
  const message = await findOneWithDecryption(em, SupplyMessage, { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, direction: 'inbound', deletedAt: null }, undefined, input.scope)
  if (!supplyCase || !message) return { status: 'needs_human', reason: 'interpretation_not_found' }
  if (!['proposal_queued', 'proposal_delivered'].includes(supplyCase.status)) return { status: 'display_only', reason: 'interpretation_not_awaiting' }
  if (!['no_envelope', 'schema_invalid', 'invalid_json', 'unterminated_block'].includes(message.validationStatus ?? '')) return { status: 'display_only', reason: 'interpretation_not_eligible' }
  const sanitized = sanitizeReplyText(message.bodyExcerpt ?? '', { ownOrderNumber: supplyCase.orderNumber })
  const prescan = preScanReplyText(sanitized.text)
  if (!sanitized.ok) {
    await storeBlockedInterpretation({ em: input.em, scope: input.scope, caseId: input.caseId, supplyMessageId: input.supplyMessageId, reason: sanitized.reason, inputChars: sanitized.inputChars, outputChars: sanitized.outputChars, prescan })
    return { status: 'needs_human', reason: sanitized.reason }
  }
  if (prescan.hit) {
    await storeBlockedInterpretation({ em: input.em, scope: input.scope, caseId: input.caseId, supplyMessageId: input.supplyMessageId, reason: 'interpretation_blocked_suspicious_content', inputChars: sanitized.inputChars, outputChars: sanitized.outputChars, prescan })
    return { status: 'needs_human', reason: 'interpretation_blocked_suspicious_content' }
  }
  const configResult = input.config ? { ok: true as const, config: input.config } : parseReplyInterpreterConfig()
  const config = configResult.ok ? configResult.config : {
    provider: 'unconfigured', model: 'unconfigured', timeoutMs: 15_000, maxAttemptsPerCase: 3, maxAttemptsPerDay: 30, maxOutputTokens: 1_500,
  }
  const modelInput = inputForCase(supplyCase, sanitized.text)
  const serializedInput = canonicalReplyInterpreterInput(modelInput)
  const claim = await claimReplyInterpretationAttempt({
    em: input.em,
    scope: input.scope,
    caseId: input.caseId,
    supplyMessageId: input.supplyMessageId,
    config,
    modelInput,
    attemptNo: input.attemptNo,
    sanitizer: { version: 's1', inputChars: sanitized.inputChars, outputChars: sanitized.outputChars, prescan },
  })
  if (claim.kind !== 'claimed') return { status: 'needs_human', reason: claim.kind === 'skipped' ? claim.reason : 'interpretation_in_progress', runId: claim.kind === 'in_progress' ? claim.runId : undefined }
  const promptHash = createHash('sha256').update(SUPPLIER_REPLY_INTERPRETER_SYSTEM_PROMPT).digest('hex')
  await markReplyInterpretationPrepared({ em: input.em, scope: input.scope, caseId: input.caseId, supplyMessageId: input.supplyMessageId, runId: claim.attempt.runId, systemPromptHash: promptHash })
  const finalize = (result: Parameters<typeof finalizeReplyInterpretationAttempt>[0]['result']) => finalizeReplyInterpretationAttempt({ em: input.em, scope: input.scope, caseId: input.caseId, supplyMessageId: input.supplyMessageId, runId: claim.attempt.runId, result: { ...result, systemPromptHash: promptHash } })
  if (!configResult.ok) {
    const attempt = await finalize({ output: null, intent: null, outcome: 'missing_config', errorCode: 'missing_config', providerRequestCount: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: null } })
    await reportUsage({ em: input.em, scope: input.scope, attempt })
    return { status: 'needs_human', reason: 'interpretation_unavailable', runId: claim.attempt.runId }
  }
  const effective: EffectiveCall = { provider: null, model: null }
  try {
    const result = await runWithDeadline({ runner: input.runObject ?? (runAiAgentObject as unknown as InterpreterRunner), request: buildReplyInterpreterRuntimeRequest({ serializedInput, config, container: input.container, runId: claim.attempt.runId, scope: input.scope, effective }), timeoutMs: config.timeoutMs })
    if (result.mode !== 'generate') throw new Error('[internal] reply interpreter must use generate mode')
    const parsed = supplierReplyInterpreterOutputSchema.safeParse(result.object)
    const validated = parsed.success ? validateReplyIntent(parsed.data, sanitized.text) : { ok: false as const, code: 'interpretation_invalid_output' as const, issues: ['schema validation failed'] }
    if (!parsed.success || !validated.ok || result.finishReason === 'length') {
      // A wire object that never became a valid intent is not stored as one; the reason is in errorCode/checks.
      const attempt = await finalize({ output: validated.ok ? validated.intent : null, intent: null, outcome: parsed.success ? 'ok' : 'invalid_output', errorCode: result.finishReason === 'length' ? 'output_truncated' : (validated.ok ? null : validated.code), providerRequestCount: 1, usage: result.usage, effectiveProvider: effective.provider, effectiveModel: effective.model, checks: { schema: parsed.success ? 'pass' : 'fail', consistency: validated.ok ? 'pass' : validated.code, grounding: validated.ok ? 'pass' : validated.code, confidenceOk: parsed.success && parsed.data.confidence >= 0.7 } })
      await reportUsage({ em: input.em, scope: input.scope, attempt })
      return { status: 'needs_human', reason: validated.ok ? 'interpretation_invalid_output' : validated.code, runId: claim.attempt.runId }
    }
    const lowConfidence = validated.intent.confidence < 0.7
    const attempt = await finalize({ output: validated.intent, intent: validated.intent, outcome: 'ok', errorCode: null, providerRequestCount: 1, usage: result.usage, effectiveProvider: effective.provider, effectiveModel: effective.model, checks: { schema: 'pass', consistency: 'pass', grounding: 'pass', confidenceOk: !lowConfidence } })
    await reportUsage({ em: input.em, scope: input.scope, attempt })
    if (lowConfidence) return { status: 'display_only', reason: 'interpretation_low_confidence', runId: claim.attempt.runId }
    const materialized = await materializeDerivedCounter({ em: input.em, scope: input.scope, caseId: input.caseId, sourceMessageId: input.supplyMessageId, intent: validated.intent, today: new Date().toISOString().slice(0, 10) })
    if (materialized) return { status: 'counter_received', reason: 'derived_counter_created', runId: claim.attempt.runId, counterId: materialized.counterId }
    return { status: 'display_only', reason: 'interpretation_display_only', runId: claim.attempt.runId }
  } catch (error) {
    const outcome = classifyFailure(error)
    const detail = describeInterpreterError(error)
    const attempt = await finalize({ output: null, intent: null, outcome, errorCode: outcome, providerRequestCount: retryable(error) ? 2 : 1, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: null }, effectiveProvider: effective.provider, effectiveModel: effective.model })
    await reportUsage({ em: input.em, scope: input.scope, attempt })
    logger.warn('Supplier reply interpretation failed', { runId: claim.attempt.runId, outcome, errorName: detail.name, httpStatus: detail.status, message: detail.message })
    reportError(new Error(detail.message), { module: 'supplier_demo', code: 'supplier_demo.reply_interpretation_failed', attributes: { runId: claim.attempt.runId, outcome, errorName: detail.name, ...(detail.status === null ? {} : { httpStatus: detail.status }) } })
    return { status: 'needs_human', reason: `interpretation_${outcome}`, runId: claim.attempt.runId }
  }
}

export type ReplyInterpreterSmokeResult = {
  ok: boolean
  model?: string | null
  usage?: { inputTokens?: number; outputTokens?: number } | null
  reason?: string
  issues?: string[]
  error?: { name: string; status: number | null; message: string }
  kind?: string
  tranches?: string[]
}

export async function runSupplierReplyInterpreterSmoke(input: { container: AwilixContainer; scope: InterpretationScope; text: string; runObject?: InterpreterRunner }): Promise<ReplyInterpreterSmokeResult> {
  const configResult = parseReplyInterpreterConfig()
  if (!configResult.ok) return { ok: false, reason: 'missing_config' }
  const modelInput = { promptVersion: SUPPLIER_REPLY_INTERPRETER_PROMPT_VERSION, sanitizerVersion: 's1', today: new Date().toISOString().slice(0, 10), todayWeekday: dayExpression(new Date().toISOString().slice(0, 10)), case: { sku: 'MAT-42', unit: 'pcs', currentProposal: [{ quantity: 400, date: new Date().toISOString().slice(0, 10) }], totalQuantity: 400 }, message: { language_hint: null, text: input.text } }
  const effective: EffectiveCall = { provider: null, model: null }
  try {
    const result = await (input.runObject ?? (runAiAgentObject as unknown as InterpreterRunner))(buildReplyInterpreterRuntimeRequest({ serializedInput: JSON.stringify(modelInput), config: configResult.config, container: input.container, runId: randomUUID(), scope: input.scope, effective }))
    const parsed = supplierReplyInterpreterOutputSchema.safeParse(result.object)
    return {
      ok: result.mode === 'generate' && parsed.success,
      model: effective.model,
      usage: await result.usage,
      ...(parsed.success
        ? { kind: parsed.data.kind, tranches: parsed.data.tranches.map((tranche) => `${tranche.quantityIsRemainder ? 'rest' : tranche.quantity}@${tranche.dateKind}${tranche.dateKind === 'weekday' ? `:${tranche.weekday}/${tranche.weekdayWhich}` : tranche.dateKind === 'iso' ? `:${tranche.dateIso}` : tranche.dateKind === 'week' ? `:+${tranche.weekOffset}` : ''}`) }
        : { reason: 'invalid_output', issues: parsed.error.issues.map((issue) => issue.message).slice(0, 5) }),
    }
  } catch (error) {
    // The owner runs this to find out why a live call failed, so the provider's own reason has to be visible.
    return { ok: false, model: effective.model, reason: classifyFailure(error), error: describeInterpreterError(error) }
  }
}
