import { createHash, randomUUID } from "node:crypto";
import type { AwilixContainer } from "awilix";
import type { EntityManager } from "@mikro-orm/postgresql";
import { generateObject } from "ai";
import {
  runAiAgentObject,
  type RunAiAgentObjectInput,
  type RunAiAgentObjectResult,
} from "@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime";
import { findOneWithDecryption } from "@open-mercato/shared/lib/encryption/find";
import { SupplyCase, SupplyMessage } from "../../data/entities";
import { emitSupplierDemoEvent } from "../../events";
import { createNegotiationRecord, parseNegotiationRecord } from "../negotiation-record";
import { createLogger } from "@open-mercato/shared/lib/logger";
import { parseSupplierAgentConfig, type SupplierAgentConfig } from "./config";
import {
  buildSupplierCounterAgentInput,
  hashSupplierText,
  serializeSupplierCounterAgentInput,
} from "./input";
import {
  claimSupplierCounterAttempt,
  finalizeSupplierCounterAttempt,
  markSupplierAttemptPrepared,
  type SupplierAttemptScope,
} from "./attempts";
import {
  isConsistentSupplierCounterOutput,
  SUPPLIER_COUNTER_NEGOTIATOR_AGENT_ID,
  SUPPLIER_COUNTER_NEGOTIATOR_SYSTEM_PROMPT,
  supplierCounterAgentOutputSchema,
  type SupplierCounterAgentOutput,
} from "../../ai-agents";

const logger = createLogger("supplier_demo").child({ component: "counter-agent" });

type SupplierAgentObjectResult =
  RunAiAgentObjectResult<SupplierCounterAgentOutput>;
type SupplierAgentObjectRunner = (
  input: RunAiAgentObjectInput<SupplierCounterAgentOutput>,
) => Promise<SupplierAgentObjectResult>;

type FailureOutcome =
  | "timeout"
  | "rate_limited"
  | "provider_error"
  | "missing_config"
  | "refusal";

// What the runtime actually used for this call, captured from the prepared options (tenant prompt or model
// overrides make the configured values untrustworthy for the audit).
type EffectiveCall = {
  provider: string | null;
  model: string | null;
  systemPrompt: string | null;
};

function errorStatus(error: unknown): number | null {
  const candidate = error as { statusCode?: unknown; status?: unknown } | null;
  const value = candidate?.statusCode ?? candidate?.status;
  return typeof value === "number" ? value : null;
}

// Operator-safe description of a failed model call: error name, HTTP status and a short message with anything
// that looks like a credential redacted. Never the request, the prompt or headers.
export function describeAgentError(error: unknown): {
  name: string;
  status: number | null;
  message: string;
} {
  const name = error instanceof Error ? error.name : typeof error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  const raw = [
    error instanceof Error ? error.message : String(error),
    cause instanceof Error ? `cause: ${cause.message}` : "",
    typeof (error as { responseBody?: unknown } | null)?.responseBody === "string"
      ? `response: ${(error as { responseBody: string }).responseBody}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const message = raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
  return { name, status: errorStatus(error), message };
}

function classifyAgentFailure(error: unknown): FailureOutcome {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === "supplier_agent_timeout" ||
    name === "AbortError" ||
    name === "TimeoutError"
  )
    return "timeout";
  if (name === "AiModelFactoryError" || message.includes("api key"))
    return "missing_config";
  const status = errorStatus(error);
  if (status === 429) return "rate_limited";
  if (message.includes("content filter") || message.includes("refus"))
    return "refusal";
  return "provider_error";
}

async function runWithDeadline(input: {
  runObject: SupplierAgentObjectRunner;
  request: RunAiAgentObjectInput<SupplierCounterAgentOutput>;
  timeoutMs: number;
}): Promise<SupplierAgentObjectResult> {
  let timer: NodeJS.Timeout | undefined;
  // Guard race only; the HTTP call itself is aborted by the signal handed to the generateObject callback.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(
            new Error("[internal] supplier agent deadline exceeded"),
            { code: "supplier_agent_timeout" },
          ),
        ),
      input.timeoutMs + 2_000,
    );
  });
  try {
    return await Promise.race([input.runObject(input.request), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildRuntimeRequest(input: {
  serializedInput: string;
  config: SupplierAgentConfig;
  container?: AwilixContainer;
  runId: string;
  scope: SupplierAttemptScope;
  effective: EffectiveCall;
}): RunAiAgentObjectInput<SupplierCounterAgentOutput> {
  return {
    agentId: SUPPLIER_COUNTER_NEGOTIATOR_AGENT_ID,
    input: input.serializedInput,
    authContext: {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      userId: "supplier-demo-system",
      features: ["supplier_demo.supply_cases.manage"],
      isSuperAdmin: false,
    },
    providerOverride: input.config.provider,
    modelOverride: input.config.model,
    container: input.container,
    sessionId: input.runId,
    enableTools: false,
    // No per-call `loop`: the agent definition pins maxSteps 1 and forbids runtime loop overrides, so passing one
    // here makes the runtime reject every call (AgentPolicyError) before the provider is reached.
    generateObject: async (
      options: Parameters<
        NonNullable<
          RunAiAgentObjectInput<SupplierCounterAgentOutput>["generateObject"]
        >
      >[0],
    ) => {
      const model = options.model as { provider?: unknown; modelId?: unknown };
      input.effective.provider =
        typeof model?.provider === "string" ? model.provider : null;
      input.effective.model =
        typeof model?.modelId === "string" ? model.modelId : null;
      input.effective.systemPrompt =
        typeof options.system === "string" ? options.system : null;
      const localAbort = new AbortController();
      const timeout = setTimeout(
        () => localAbort.abort(),
        input.config.timeoutMs,
      );
      try {
        const abortSignal =
          typeof AbortSignal.any === "function"
            ? AbortSignal.any([
                options.abortSignal ?? new AbortController().signal,
                localAbort.signal,
              ])
            : localAbort.signal;
        return await generateObject({
          ...options,
          schema: options.schema as never,
          maxOutputTokens: input.config.maxOutputTokens,
          abortSignal,
        } as never);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function emitAfterRun(
  input: {
    em: EntityManager;
    scope: SupplierAttemptScope;
    caseId: string;
    supplyMessageId: string;
  },
  announceAttention = true,
): Promise<{ status: string; reason: string }> {
  const em = input.em.fork();
  const supplyCase = await findOneWithDecryption(
    em,
    SupplyCase,
    { ...input.scope, id: input.caseId, deletedAt: null },
    undefined,
    input.scope,
  );
  const counter = await findOneWithDecryption(
    em,
    SupplyMessage,
    { ...input.scope, id: input.supplyMessageId, supplyCaseId: input.caseId, deletedAt: null },
    undefined,
    input.scope,
  );
  const status = supplyCase?.status ?? "missing";
  const reason = supplyCase?.statusReason ?? "";
  const record = counter?.negotiationRecord
    ? parseNegotiationRecord(counter.negotiationRecord)
    : null;
  const options = {
    persistent: true,
    ...({ deliverInline: false } as Record<string, unknown>),
  };
  if (
    record?.dispatch.state === "pending" &&
    record.recommendation?.autoEligible &&
    !record.verdict
  ) {
    await emitSupplierDemoEvent(
      "supplier_demo.supply_case.recommendation_ready",
      {
        ...input.scope,
        caseId: input.caseId,
        supplyMessageId: input.supplyMessageId,
        recommendationId: record.recommendation.id,
        evaluationId: record.recommendation.evaluationId,
        autoEligible: true,
      },
      options,
    );
  } else if (announceAttention && status === "needs_human") {
    await emitSupplierDemoEvent(
      "supplier_demo.supply_case.attention_required",
      { ...input.scope, caseId: input.caseId, reason, status },
      options,
    );
  }
  return { status, reason };
}

export async function runSupplierCounterNegotiation(input: {
  em: EntityManager;
  scope: SupplierAttemptScope;
  caseId: string;
  supplyMessageId: string;
  container?: AwilixContainer;
  config?: SupplierAgentConfig;
  runObject?: SupplierAgentObjectRunner;
}): Promise<{ status: string; reason: string; runId?: string }> {
  const configResult = input.config
    ? { ok: true as const, config: input.config }
    : parseSupplierAgentConfig();
  const effectiveConfig: SupplierAgentConfig = configResult.ok
    ? configResult.config
    : {
        provider: "unconfigured",
        model: "unconfigured",
        timeoutMs: 20_000,
        maxRunsPerCase: 4,
        maxRunsPerDay: 50,
        maxOutputTokens: 4_000,
        maxNegotiationTurns: 3,
      };
  const em = input.em.fork();
  const counter = await findOneWithDecryption(
    em,
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
  if (!counter?.negotiationRecord)
    return { status: "needs_human", reason: "counter_not_found" };
  const record = parseNegotiationRecord(counter.negotiationRecord);
  if (!record.evaluation)
    return { status: "needs_human", reason: "evaluation_missing" };
  const agentInput = buildSupplierCounterAgentInput(record);
  const serializedInput = serializeSupplierCounterAgentInput(agentInput);
  const claim = await claimSupplierCounterAttempt({
    em: input.em,
    scope: input.scope,
    caseId: input.caseId,
    supplyMessageId: input.supplyMessageId,
    config: effectiveConfig,
    modelInput: agentInput as unknown as Record<string, unknown>,
  });
  if (claim.kind !== "claimed") {
    // Caps and stale-lease recovery move the case to needs_human: tell the operator once. A redelivered event
    // for a completed run only re-emits a lost auto-dispatch intent, never a second notification.
    const settledNow =
      claim.kind === "skipped" &&
      ["agent_timeout", "max_runs_per_case", "max_runs_per_day"].includes(claim.reason);
    const settled = await emitAfterRun(input, settledNow);
    return {
      status: settled.status,
      reason: claim.kind === "in_progress" ? "agent_in_progress" : claim.reason,
    };
  }
  const runObject =
    input.runObject ??
    (runAiAgentObject as unknown as SupplierAgentObjectRunner);
  const configuredPromptHash = createHash("sha256")
    .update(SUPPLIER_COUNTER_NEGOTIATOR_SYSTEM_PROMPT)
    .digest("hex");
  const messagesHash = hashSupplierText(serializedInput);
  await markSupplierAttemptPrepared({
    em: input.em,
    scope: input.scope,
    caseId: input.caseId,
    supplyMessageId: input.supplyMessageId,
    runId: claim.attempt.runId,
    systemPrompt: SUPPLIER_COUNTER_NEGOTIATOR_SYSTEM_PROMPT,
    systemPromptHash: configuredPromptHash,
    effectiveMessagesHash: messagesHash,
  });
  const finalize = (
    result: Parameters<typeof finalizeSupplierCounterAttempt>[0]["result"],
  ) =>
    finalizeSupplierCounterAttempt({
      em: input.em,
      scope: input.scope,
      caseId: input.caseId,
      supplyMessageId: input.supplyMessageId,
      runId: claim.attempt.runId,
      result: { effectiveMessagesHash: messagesHash, ...result },
    });
  if (!configResult.ok) {
    await finalize({
      output: null,
      outcome: "missing_config",
      errorCode: "missing_config",
      finishReason: null,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: null },
      providerRequestCount: 0,
    });
    const settled = await emitAfterRun(input);
    return { ...settled, runId: claim.attempt.runId };
  }
  const effective: EffectiveCall = {
    provider: null,
    model: null,
    systemPrompt: null,
  };
  const audit = () => ({
    effectiveProvider: effective.provider ?? effectiveConfig.provider,
    effectiveModel: effective.model ?? effectiveConfig.model,
    systemPrompt: effective.systemPrompt ?? SUPPLIER_COUNTER_NEGOTIATOR_SYSTEM_PROMPT,
    systemPromptHash: effective.systemPrompt
      ? createHash("sha256").update(effective.systemPrompt).digest("hex")
      : configuredPromptHash,
  });
  try {
    const result = await runWithDeadline({
      runObject,
      request: buildRuntimeRequest({
        serializedInput,
        config: effectiveConfig,
        container: input.container,
        runId: claim.attempt.runId,
        scope: input.scope,
        effective,
      }),
      timeoutMs: effectiveConfig.timeoutMs,
    });
    if (result.mode !== "generate")
      throw new Error(
        "[internal] supplier counter agent must use generate mode",
      );
    const parsed = supplierCounterAgentOutputSchema.safeParse(result.object);
    const consistent =
      parsed.success && isConsistentSupplierCounterOutput(parsed.data);
    // O3: a chosen option must exist in the persisted evaluation the model was shown.
    const selected =
      consistent && parsed.data.optionId
        ? (record.evaluation.options.find(
            (option) => option.id === parsed.data.optionId,
          ) ?? null)
        : null;
    const valid =
      consistent &&
      result.finishReason !== "length" &&
      (parsed.data.decision === "escalate" || parsed.data.decision === "decline" || Boolean(selected));
    if (!valid || !parsed.success) {
      await finalize({
        output: parsed.success ? parsed.data : null,
        outcome: "invalid_output",
        errorCode: "invalid_output",
        finishReason: result.finishReason ?? null,
        usage: result.usage,
        providerRequestCount: 1,
        ...audit(),
      });
    } else {
      await finalize({
        output: parsed.data,
        outcome: "ok",
        recommendation: {
          optionId: parsed.data.optionId,
          decision: parsed.data.decision,
          reasonCodes: parsed.data.reasonCodes,
        },
        finishReason: result.finishReason ?? null,
        usage: result.usage,
        providerRequestCount: 1,
        ...audit(),
      });
    }
  } catch (error) {
    const outcome = classifyAgentFailure(error);
    const detail = describeAgentError(error);
    // A bare "provider_error" is not diagnosable: keep the error class and HTTP status on the attempt and log the
    // sanitised message (never the prompt, headers or key).
    logger.warn("Supplier counter agent call failed", {
      runId: claim.attempt.runId,
      outcome,
      errorName: detail.name,
      httpStatus: detail.status,
      message: detail.message,
    });
    await finalize({
      output: null,
      outcome,
      errorCode: `${outcome}:${detail.name}`.slice(0, 80),
      httpStatus: detail.status,
      finishReason: null,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: null },
      providerRequestCount: effective.model ? 1 : 0,
      ...audit(),
    });
  }
  const settled = await emitAfterRun(input);
  return { ...settled, runId: claim.attempt.runId };
}

// TEST-216 / MA-202: one live, toolless call on a synthetic evaluation. No case, slot or commitment is read or
// written; the result is only printed by `demo:agent-smoke --live`.
export async function runSupplierCounterAgentSmoke(input: {
  container: AwilixContainer;
  scope: SupplierAttemptScope;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  model: string | null;
  output?: SupplierCounterAgentOutput;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: ReturnType<typeof describeAgentError> & { outcome: string };
}> {
  const configResult = parseSupplierAgentConfig();
  if (!configResult.ok)
    return {
      ok: false,
      latencyMs: 0,
      model: null,
      error: { outcome: "missing_config", name: "SupplierAgentConfig", status: null, message: configResult.issues.map((issue) => `${issue.key}:${issue.code}`).join(", ") },
    };
  const config = configResult.config;
  const record = createNegotiationRecord();
  record.counterRule = { ok: true, failed: null };
  record.evaluation = {
    id: randomUUID(),
    evaluatedAt: new Date().toISOString(),
    turnAtEvaluation: 0,
    maxTurns: config.maxNegotiationTurns,
    reasonCodes: ["requested_feasible_within_policy"],
    options: [{
      id: "requested",
      commitments: [{ quantity: 450, date: "2026-09-23" }, { quantity: 50, date: "2026-09-25" }],
      feasible: true,
      policyDecision: "auto_approved",
      incrementalCost: 0,
      maxShiftHours: 0,
      slaProtected: true,
      highPriorityAllocationMoved: false,
      movedAllocations: [],
      executionFingerprint: "smoke",
      distance: 0,
    }],
  };
  const effective: EffectiveCall = { provider: null, model: null, systemPrompt: null };
  const startedAt = Date.now();
  try {
    const result = await runWithDeadline({
      runObject: runAiAgentObject as unknown as SupplierAgentObjectRunner,
      request: buildRuntimeRequest({
        serializedInput: serializeSupplierCounterAgentInput(buildSupplierCounterAgentInput(record)),
        config,
        container: input.container,
        runId: randomUUID(),
        scope: input.scope,
        effective,
      }),
      timeoutMs: config.timeoutMs,
    });
    const parsed = result.mode === "generate" ? supplierCounterAgentOutputSchema.safeParse(result.object) : null;
    const ok = Boolean(parsed?.success && isConsistentSupplierCounterOutput(parsed.data));
    return {
      ok,
      latencyMs: Date.now() - startedAt,
      model: effective.model,
      ...(parsed?.success ? { output: parsed.data } : {}),
      ...(result.mode === "generate" ? { usage: result.usage } : {}),
      ...(ok ? {} : { error: { outcome: "invalid_output", name: "OutputValidation", status: null, message: JSON.stringify(result.mode === "generate" ? result.object : null).slice(0, 500) } }),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      model: effective.model,
      error: { outcome: classifyAgentFailure(error), ...describeAgentError(error) },
    };
  }
}
