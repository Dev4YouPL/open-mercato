import { createHash, randomUUID } from "node:crypto";
import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import {
  findOneWithDecryption,
  findWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";
import { SupplyCase, SupplyMessage } from "../../data/entities";
import {
  buildNegotiationRecommendation,
  parseNegotiationRecord,
  type SupplierNegotiationRecord,
} from "../negotiation-record";
import { reportSupplierAttemptUsage, reportSupplierUsageError } from "./usage";
import type { SupplierAgentConfig } from "./config";
import { SUPPLIER_COUNTER_PROMPT_VERSION } from "../../ai-agents";

export type SupplierAttemptScope = { tenantId: string; organizationId: string };

type Attempt = SupplierNegotiationRecord["agent"]["attempts"][number];

export type SupplierAttemptClaim = {
  kind: "claimed";
  caseId: string;
  supplyMessageId: string;
  evaluationId: string;
  attempt: Attempt;
  inputHash: string;
};

export type SupplierAttemptClaimResult =
  | SupplierAttemptClaim
  | { kind: "in_progress"; runId: string; leaseExpiresAt: string }
  | { kind: "completed"; reason: string }
  | { kind: "skipped"; reason: string };

// The case status while a counter is being evaluated or analysed by the agent. Every agent-side status change is
// fenced on it: once a human or another command moved the case on, a late agent result can no longer touch it.
export const COUNTER_IN_FLIGHT_STATUS = "counter_received";

const ACTIVE_LEASE_MARGIN_MS = 30_000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

function advisoryKey(tenantId: string): string {
  return `supplier_demo.counter_negotiator:${tenantId}`;
}

async function lockTenantNegotiation(
  tx: EntityManager,
  tenantId: string,
): Promise<void> {
  await tx
    .getConnection()
    .execute("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
      advisoryKey(tenantId),
    ]);
}

function attemptUsageZero(): Attempt["usage"] {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: null,
    known: false,
    partial: true,
  };
}

function activeAttempt(record: SupplierNegotiationRecord): Attempt | null {
  return (
    record.agent.attempts.find(
      (attempt) =>
        attempt.runId === record.agent.activeRunId && attempt.finishedAt === null,
    ) ?? null
  );
}

function markExpiredAttempt(
  record: SupplierNegotiationRecord,
  now: Date,
): Attempt | null {
  const active = activeAttempt(record);
  if (!active || new Date(active.leaseExpiresAt).getTime() > now.getTime())
    return null;
  active.finishedAt = now.toISOString();
  active.latencyMs = Math.max(
    0,
    now.getTime() - new Date(active.startedAt).getTime(),
  );
  active.auditState = "incomplete";
  active.usage = attemptUsageZero();
  active.providerRequestCount = 0;
  active.finishReason = "timeout";
  active.outcome = "timeout";
  active.errorCode = "lease_expired";
  active.httpStatus = null;
  active.output = null;
  record.agent.activeRunId = null;
  record.agent.state = "failed";
  record.agent.skipReason = "agent_timeout";
  return active;
}

// Deterministic fallback (spec "Recommendation"): the buyer's requested split, only when it is feasible. Never an
// automatic send: a deterministic recommendation is never auto-eligible.
function applyDeterministicFallback(
  record: SupplierNegotiationRecord,
  now: Date,
  reason: string,
): void {
  if (record.recommendation || !record.evaluation) return;
  const requested = record.evaluation.options.find(
    (option) => option.id === "requested" && option.feasible,
  );
  if (!requested) return;
  record.recommendation = buildNegotiationRecommendation({
    record,
    source: "deterministic",
    optionId: requested.id,
    decision: "accept_requested",
    reasonCodes: ["deterministic_fallback", reason],
    createdAt: now,
  });
}

async function latestValidCounterId(
  tx: EntityManager,
  scope: SupplierAttemptScope,
  caseId: string,
): Promise<string | null> {
  const counters = await findWithDecryption(
    tx,
    SupplyMessage,
    {
      ...scope,
      supplyCaseId: caseId,
      direction: "inbound",
      messageType: "SUPPLY_COUNTER_PROPOSAL",
      validationStatus: "valid",
      deletedAt: null,
    },
    { orderBy: { createdAt: "desc" } },
    scope,
  );
  return counters[0]?.id ?? null;
}

// The per-case cap covers all counters of the case, not one counter (spec "Attempt cap").
async function caseAttemptCount(
  tx: EntityManager,
  scope: SupplierAttemptScope,
  caseId: string,
): Promise<number> {
  const counters = await findWithDecryption(
    tx,
    SupplyMessage,
    {
      ...scope,
      supplyCaseId: caseId,
      direction: "inbound",
      messageType: "SUPPLY_COUNTER_PROPOSAL",
      deletedAt: null,
    },
    undefined,
    scope,
  );
  return counters.reduce(
    (total, message) =>
      total +
      (message.negotiationRecord
        ? parseNegotiationRecord(message.negotiationRecord).agent.attempts.length
        : 0),
    0,
  );
}

// Rolling 24 h window over every claimed attempt of the tenant (crashed and failed attempts count too).
async function dailyAttemptCount(
  tx: EntityManager,
  scope: SupplierAttemptScope,
  now: Date,
): Promise<number> {
  const since = now.getTime() - DAILY_WINDOW_MS;
  const messages = await findWithDecryption(
    tx,
    SupplyMessage,
    {
      tenantId: scope.tenantId,
      direction: "inbound",
      messageType: "SUPPLY_COUNTER_PROPOSAL",
      deletedAt: null,
    },
    undefined,
    scope,
  );
  return messages.reduce((total, message) => {
    if (!message.negotiationRecord) return total;
    const record = parseNegotiationRecord(message.negotiationRecord);
    return (
      total +
      record.agent.attempts.filter(
        (attempt) => new Date(attempt.startedAt).getTime() >= since,
      ).length
    );
  }, 0);
}

function buildAttempt(input: {
  record: SupplierNegotiationRecord;
  config: SupplierAgentConfig;
  evaluationId: string;
  input: Record<string, unknown>;
  now: Date;
}): Attempt {
  const runId = randomUUID();
  const inputHash = createHash("sha256")
    .update(JSON.stringify(input.input))
    .digest("hex");
  const attemptNo = input.record.agent.nextAttemptNo;
  return {
    attemptNo,
    runId,
    evaluationId: input.evaluationId,
    startedAt: input.now.toISOString(),
    leaseExpiresAt: new Date(
      input.now.getTime() + input.config.timeoutMs + ACTIVE_LEASE_MARGIN_MS,
    ).toISOString(),
    finishedAt: null,
    latencyMs: null,
    configuredProvider: input.config.provider,
    configuredModel: input.config.model,
    effectiveProvider: null,
    effectiveModel: null,
    promptVersion: SUPPLIER_COUNTER_PROMPT_VERSION,
    effectiveSystemPrompt: null,
    systemPromptHash: null,
    effectiveMessagesHash: null,
    inputHash,
    input: input.input,
    auditState: "claimed",
    usageEventId: null,
    usage: attemptUsageZero(),
    providerRequestCount: 0,
    finishReason: null,
    outcome: null,
    errorCode: null,
    httpStatus: null,
    output: null,
  };
}

async function recordUsageEventId(
  em: EntityManager,
  scope: SupplierAttemptScope,
  caseId: string,
  supplyMessageId: string,
  attempt: Attempt,
): Promise<void> {
  try {
    const usageEventId = await reportSupplierAttemptUsage({
      em,
      scope,
      agentId: "supplier_demo.counter_negotiator",
      attempt,
    });
    await em.transactional(async (tx) => {
      await lockTenantNegotiation(tx, scope.tenantId);
      const counter = await findOneWithDecryption(
        tx,
        SupplyMessage,
        { ...scope, id: supplyMessageId, supplyCaseId: caseId, deletedAt: null },
        undefined,
        scope,
      );
      if (!counter?.negotiationRecord) return;
      const record = parseNegotiationRecord(counter.negotiationRecord);
      const stored = record.agent.attempts.find(
        (candidate) => candidate.runId === attempt.runId,
      );
      if (!stored || stored.usageEventId) return;
      stored.usageEventId = usageEventId;
      counter.negotiationRecord = record;
      await tx.flush();
    });
  } catch (error) {
    // The recovery sweep back-fills a missing usage row later; the negotiation itself must not fail on reporting.
    reportSupplierUsageError(error, attempt.runId);
  }
}

// RCV1/RCV3: settle an expired running attempt without starting a new model call. Used by the claim path and by
// the recovery sweep. Returns true when an attempt was settled.
export async function recoverExpiredSupplierAttempt(input: {
  em: EntityManager;
  scope: SupplierAttemptScope;
  caseId: string;
  supplyMessageId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const expired = await input.em.transactional(async (tx) => {
    await lockTenantNegotiation(tx, input.scope.tenantId);
    const supplyCase = await findOneWithDecryption(
      tx,
      SupplyCase,
      { ...input.scope, id: input.caseId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      input.scope,
    );
    const counter = await findOneWithDecryption(
      tx,
      SupplyMessage,
      { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, deletedAt: null },
      undefined,
      input.scope,
    );
    if (!supplyCase || !counter?.negotiationRecord) return null;
    const record = parseNegotiationRecord(counter.negotiationRecord);
    const attempt = markExpiredAttempt(record, now);
    if (!attempt) return null;
    if (supplyCase.status === COUNTER_IN_FLIGHT_STATUS && !record.verdict) {
      applyDeterministicFallback(record, now, "agent_timeout");
      supplyCase.status = "needs_human";
      supplyCase.statusReason = "agent_timeout";
      supplyCase.updatedAt = now;
    }
    counter.negotiationRecord = record;
    await tx.flush();
    return attempt;
  });
  if (!expired) return false;
  await recordUsageEventId(
    input.em,
    input.scope,
    input.caseId,
    input.supplyMessageId,
    expired,
  );
  return true;
}

export async function claimSupplierCounterAttempt(input: {
  em: EntityManager;
  scope: SupplierAttemptScope;
  caseId: string;
  supplyMessageId: string;
  config: SupplierAgentConfig;
  modelInput: Record<string, unknown>;
  now?: Date;
}): Promise<SupplierAttemptClaimResult> {
  const now = input.now ?? new Date();
  if (
    await recoverExpiredSupplierAttempt({
      em: input.em,
      scope: input.scope,
      caseId: input.caseId,
      supplyMessageId: input.supplyMessageId,
      now,
    })
  )
    return { kind: "skipped", reason: "agent_timeout" };
  return input.em.transactional(async (tx) => {
    await lockTenantNegotiation(tx, input.scope.tenantId);
    const supplyCase = await findOneWithDecryption(
      tx,
      SupplyCase,
      { ...input.scope, id: input.caseId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      input.scope,
    );
    const counter = await findOneWithDecryption(
      tx,
      SupplyMessage,
      {
        ...input.scope,
        id: input.supplyMessageId,
        supplyCaseId: input.caseId,
        direction: "inbound",
        messageType: "SUPPLY_COUNTER_PROPOSAL",
        validationStatus: "valid",
        deletedAt: null,
      },
      undefined,
      input.scope,
    );
    if (!supplyCase || !counter?.negotiationRecord)
      return { kind: "skipped" as const, reason: "counter_not_found" };
    const record = parseNegotiationRecord(counter.negotiationRecord);
    const active = activeAttempt(record);
    if (active)
      return {
        kind: "in_progress" as const,
        runId: active.runId,
        leaseExpiresAt: active.leaseExpiresAt,
      };
    if (record.verdict)
      return { kind: "skipped" as const, reason: `counter_${record.verdict.kind}` };
    if (record.recommendation)
      return { kind: "completed" as const, reason: "recommendation_exists" };
    // Only the case's current counter, while the case is still waiting for its analysis, may start a model call.
    // A redelivered event for an older or already disposed counter must never pull the case back.
    if (
      supplyCase.status !== COUNTER_IN_FLIGHT_STATUS ||
      record.agent.state !== "not_started" ||
      !record.evaluation ||
      (await latestValidCounterId(tx, input.scope, input.caseId)) !== counter.id
    )
      return { kind: "skipped" as const, reason: "counter_not_in_flight" };
    const capReason =
      (await caseAttemptCount(tx, input.scope, input.caseId)) >= input.config.maxRunsPerCase
        ? "max_runs_per_case"
        : (await dailyAttemptCount(tx, input.scope, now)) >= input.config.maxRunsPerDay
          ? "max_runs_per_day"
          : null;
    if (capReason) {
      record.agent.state = "failed";
      record.agent.skipReason = capReason;
      applyDeterministicFallback(record, now, capReason);
      counter.negotiationRecord = record;
      supplyCase.status = "needs_human";
      supplyCase.statusReason =
        capReason === "max_runs_per_case"
          ? "agent_attempt_limit_reached"
          : "agent_daily_limit_reached";
      supplyCase.updatedAt = now;
      await tx.flush();
      return { kind: "skipped" as const, reason: capReason };
    }
    const attempt = buildAttempt({
      record,
      config: input.config,
      evaluationId: record.evaluation.id,
      input: input.modelInput,
      now,
    });
    record.agent = {
      ...record.agent,
      state: "running",
      activeRunId: attempt.runId,
      skipReason: null,
      nextAttemptNo: attempt.attemptNo + 1,
      attempts: [...record.agent.attempts, attempt],
    };
    counter.negotiationRecord = record;
    // The case stays in flight while the model runs; it is not "needs human" yet.
    supplyCase.statusReason = "agent_running";
    supplyCase.updatedAt = now;
    await tx.flush();
    return {
      kind: "claimed" as const,
      caseId: input.caseId,
      supplyMessageId: input.supplyMessageId,
      attempt,
      evaluationId: record.evaluation.id,
      inputHash: attempt.inputHash,
    };
  });
}

function failureStatusReason(
  outcome: Attempt["outcome"],
  errorCode: string | null | undefined,
): string {
  if (errorCode === "missing_config" || outcome === "missing_config")
    return "agent_unavailable";
  return `agent_${outcome ?? "unavailable"}`;
}

export async function finalizeSupplierCounterAttempt(input: {
  em: EntityManager;
  scope: SupplierAttemptScope;
  caseId: string;
  supplyMessageId: string;
  runId: string;
  result: {
    output: Record<string, unknown> | null;
    outcome: Attempt["outcome"];
    errorCode?: string | null;
    finishReason?: string | null;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number | null;
    };
    effectiveProvider?: string | null;
    effectiveModel?: string | null;
    systemPrompt?: string | null;
    systemPromptHash?: string | null;
    effectiveMessagesHash?: string | null;
    providerRequestCount?: number;
    httpStatus?: number | null;
    recommendation?: {
      optionId: "requested" | "alt_within_policy" | "alt_best_effort" | null;
      decision: "accept_requested" | "propose_alternative" | "decline" | "escalate";
      reasonCodes: string[];
    };
  };
  now?: Date;
}): Promise<Attempt> {
  const now = input.now ?? new Date();
  const finalized = await input.em.transactional(async (tx) => {
    await lockTenantNegotiation(tx, input.scope.tenantId);
    const supplyCase = await findOneWithDecryption(
      tx,
      SupplyCase,
      { ...input.scope, id: input.caseId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      input.scope,
    );
    const counter = await findOneWithDecryption(
      tx,
      SupplyMessage,
      {
        ...input.scope,
        id: input.supplyMessageId,
        supplyCaseId: input.caseId,
        direction: "inbound",
        messageType: "SUPPLY_COUNTER_PROPOSAL",
        validationStatus: "valid",
        deletedAt: null,
      },
      undefined,
      input.scope,
    );
    if (!supplyCase || !counter?.negotiationRecord)
      throw new CrudHttpError(404, { error: "Negotiation counter not found" });
    const record = parseNegotiationRecord(counter.negotiationRecord);
    const attempt = record.agent.attempts.find(
      (candidate) => candidate.runId === input.runId,
    );
    if (!attempt)
      throw new CrudHttpError(404, { error: "Negotiation attempt not found" });
    if (attempt.finishedAt) return attempt;
    // Fence: only the active run of the current evaluation, on a case still in flight, may change the
    // recommendation or the case. A late result is recorded for audit/usage and nothing else.
    const isCurrent =
      record.agent.activeRunId === input.runId &&
      attempt.evaluationId === record.evaluation?.id &&
      !record.verdict &&
      supplyCase.status === COUNTER_IN_FLIGHT_STATUS;
    const usage = input.result.usage ?? {};
    attempt.finishedAt = now.toISOString();
    attempt.latencyMs = Math.max(
      0,
      now.getTime() - new Date(attempt.startedAt).getTime(),
    );
    attempt.auditState =
      input.result.outcome === "ok" ? "complete" : "incomplete";
    attempt.effectiveProvider =
      input.result.effectiveProvider ?? attempt.effectiveProvider;
    attempt.effectiveModel =
      input.result.effectiveModel ?? attempt.effectiveModel;
    attempt.effectiveSystemPrompt =
      input.result.systemPrompt ?? attempt.effectiveSystemPrompt;
    attempt.systemPromptHash =
      input.result.systemPromptHash ?? attempt.systemPromptHash;
    attempt.effectiveMessagesHash =
      input.result.effectiveMessagesHash ?? attempt.effectiveMessagesHash;
    attempt.usage = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? null,
      known:
        usage.inputTokens !== undefined || usage.outputTokens !== undefined,
      partial:
        usage.inputTokens === undefined || usage.outputTokens === undefined,
    };
    attempt.providerRequestCount = input.result.providerRequestCount ?? 0;
    attempt.finishReason = input.result.finishReason ?? null;
    attempt.outcome = input.result.outcome;
    attempt.errorCode = input.result.errorCode ?? null;
    attempt.httpStatus = input.result.httpStatus ?? null;
    attempt.output = input.result.output;
    if (record.agent.activeRunId === input.runId) {
      record.agent.activeRunId = null;
      record.agent.state = input.result.outcome === "ok" ? "succeeded" : "failed";
      record.agent.skipReason =
        input.result.outcome === "ok"
          ? null
          : (input.result.errorCode ?? input.result.outcome);
    }
    if (isCurrent) {
      const chosen = input.result.recommendation;
      const declined = input.result.outcome === "ok" && chosen?.decision === "decline";
      if (
        input.result.outcome === "ok" &&
        chosen &&
        chosen.optionId &&
        (chosen.decision === "accept_requested" || chosen.decision === "propose_alternative")
      ) {
        record.recommendation = buildNegotiationRecommendation({
          record,
          source: "agent",
          optionId: chosen.optionId,
          decision: chosen.decision,
          reasonCodes: chosen.reasonCodes,
          createdAt: now,
        });
      } else if (!declined) {
        // A decline recommendation is not overridden by a deterministic "accept": the person sees the agent's
        // advice to refuse and decides (Reject counter / Reopen).
        applyDeterministicFallback(
          record,
          now,
          input.result.outcome === "ok" ? "agent_escalated" : (input.result.errorCode ?? input.result.outcome ?? "unknown_failure"),
        );
      }
      const autoEligible =
        record.recommendation?.source === "agent" && record.recommendation.autoEligible;
      if (autoEligible && record.recommendation) {
        // The case stays in flight; the durable dispatch intent is picked up by the auto-send subscriber or,
        // if that event is lost, by the recovery sweep.
        record.dispatch = {
          ...record.dispatch,
          state: "pending",
          recommendationId: record.recommendation.id,
          source: "auto",
          dueAt: now.toISOString(),
          heldReason: null,
          handoffCheckedAt: null,
        };
        supplyCase.statusReason = "recommendation_ready";
      } else {
        supplyCase.status = "needs_human";
        supplyCase.statusReason =
          input.result.outcome !== "ok"
            ? failureStatusReason(input.result.outcome, input.result.errorCode)
            : declined
              ? "agent_recommends_decline"
              : chosen?.decision === "escalate"
                ? "agent_escalated"
                : "recommendation_ready";
      }
      supplyCase.updatedAt = now;
    }
    counter.negotiationRecord = record;
    await tx.flush();
    return attempt;
  });
  await recordUsageEventId(
    input.em,
    input.scope,
    input.caseId,
    input.supplyMessageId,
    finalized,
  );
  return finalized;
}

export async function markSupplierAttemptPrepared(input: {
  em: EntityManager;
  scope: SupplierAttemptScope;
  caseId: string;
  supplyMessageId: string;
  runId: string;
  systemPrompt: string;
  systemPromptHash: string;
  effectiveMessagesHash: string;
}): Promise<void> {
  await input.em.transactional(async (tx) => {
    await lockTenantNegotiation(tx, input.scope.tenantId);
    const counter = await findOneWithDecryption(
      tx,
      SupplyMessage,
      {
        ...input.scope,
        id: input.supplyMessageId,
        supplyCaseId: input.caseId,
        deletedAt: null,
      },
      undefined,
      input.scope,
    );
    if (!counter?.negotiationRecord) return;
    const record = parseNegotiationRecord(counter.negotiationRecord);
    const attempt = record.agent.attempts.find(
      (candidate) => candidate.runId === input.runId,
    );
    if (!attempt || attempt.finishedAt) return;
    attempt.auditState = "prepared";
    attempt.effectiveSystemPrompt = input.systemPrompt;
    attempt.systemPromptHash = input.systemPromptHash;
    attempt.effectiveMessagesHash = input.effectiveMessagesHash;
    counter.negotiationRecord = record;
    await tx.flush();
  });
}
