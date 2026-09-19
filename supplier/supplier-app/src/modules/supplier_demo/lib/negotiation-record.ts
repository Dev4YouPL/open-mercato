import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commitmentSchema } from "./envelope";

const movedAllocationSchema = z
  .object({
    fromSlotId: z.string().optional(),
    fromDate: z.string(),
    toSlotId: z.string().optional(),
    toDate: z.string(),
    toStartsAt: z.string(),
    quantity: z.number().int().positive(),
    shiftHours: z.number().nonnegative(),
    orderNumber: z.string().optional(),
  })
  .strict();

export const negotiationOptionSchema = z
  .object({
    id: z.enum(["requested", "alt_within_policy", "alt_best_effort"]),
    commitments: z.array(commitmentSchema),
    feasible: z.boolean(),
    policyDecision: z.enum(["auto_approved", "human_required"]),
    incrementalCost: z.number().nonnegative(),
    maxShiftHours: z.number().nonnegative(),
    slaProtected: z.boolean(),
    highPriorityAllocationMoved: z.boolean(),
    movedAllocations: z.array(movedAllocationSchema),
    executionFingerprint: z.string().min(1),
    distance: z.number().nonnegative(),
  })
  .strict();

const counterRuleSchema = z
  .object({
    ok: z.boolean(),
    failed: z.enum(["C1", "C2", "C3", "C4", "C5", "C6", "T1"]).nullable(),
  })
  .strict();

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().nullable(),
    known: z.boolean(),
    partial: z.boolean(),
  })
  .strict();

const attemptSchema = z
  .object({
    attemptNo: z.number().int().positive(),
    runId: z.string().uuid(),
    evaluationId: z.string().uuid(),
    startedAt: z.string(),
    leaseExpiresAt: z.string(),
    finishedAt: z.string().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
    configuredProvider: z.string(),
    configuredModel: z.string(),
    effectiveProvider: z.string().nullable(),
    effectiveModel: z.string().nullable(),
    promptVersion: z.string(),
    effectiveSystemPrompt: z.string().nullable(),
    systemPromptHash: z.string().nullable(),
    effectiveMessagesHash: z.string().nullable(),
    inputHash: z.string(),
    input: z.record(z.string(), z.unknown()),
    auditState: z.enum(["claimed", "prepared", "complete", "incomplete"]),
    usageEventId: z.string().nullable(),
    usage: usageSchema,
    providerRequestCount: z.number().int().nonnegative(),
    finishReason: z.string().nullable(),
    outcome: z
      .enum([
        "ok",
        "timeout",
        "rate_limited",
        "provider_error",
        "invalid_output",
        "refusal",
        "missing_config",
        "principal_missing",
        "cancelled",
      ])
      .nullable(),
    errorCode: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    output: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

export const negotiationRecordSchema = z
  .object({
    version: z.literal(1),
    counterRule: counterRuleSchema.nullable(),
    evaluation: z
      .object({
        id: z.string().uuid(),
        evaluatedAt: z.string(),
        turnAtEvaluation: z.number().int().nonnegative(),
        maxTurns: z.number().int().positive(),
        reasonCodes: z.array(z.string()),
        options: z.array(negotiationOptionSchema).max(3),
        // Supply situation the agent reasons about (numbers only). Optional: records written before it existed.
        context: z
          .object({
            originalCommitment: z.array(commitmentSchema),
            currentCommitment: z.array(commitmentSchema),
            requestedCommitments: z.array(commitmentSchema),
            originalDate: z.string().nullable(),
            stockOnOriginalDate: z.number().int().nonnegative(),
            shortfallQuantity: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullable(),
    agent: z
      .object({
        state: z.enum([
          "not_started",
          "running",
          "succeeded",
          "failed",
          "skipped",
        ]),
        nextAttemptNo: z.number().int().positive(),
        activeRunId: z.string().uuid().nullable(),
        skipReason: z.string().nullable(),
        attempts: z.array(attemptSchema),
      })
      .strict(),
    recommendation: z
      .object({
        id: z.string().uuid(),
        evaluationId: z.string().uuid(),
        source: z.enum(["agent", "deterministic"]),
        optionId: z.enum(["requested", "alt_within_policy", "alt_best_effort"]),
        commitments: z.array(commitmentSchema),
        executionFingerprint: z.string(),
        decision: z.enum([
          "accept_requested",
          "requested",
          "propose_alternative",
          "escalate",
        ]),
        reasonCodes: z.array(z.string()),
        gates: z.record(z.string(), z.enum(["pass", "fail", "n/a"])),
        autoEligible: z.boolean(),
        createdAt: z.string(),
      })
      .strict()
      .nullable(),
    dispatch: z
      .object({
        state: z.enum([
          "none",
          "pending",
          "revision_pending",
          "held",
          "handed_off",
        ]),
        recommendationId: z.string().uuid().nullable(),
        revisedProposalMessageId: z.string().uuid().nullable(),
        source: z.enum(["auto", "human"]).nullable(),
        dueAt: z.string().nullable(),
        heldReason: z.string().nullable(),
        handoffCheckedAt: z.string().nullable(),
      })
      .strict(),
    verdict: z
      .object({
        kind: z.enum(["auto_approved", "approved", "rejected", "superseded"]),
        by: z.string(),
        at: z.string(),
        reason: z.string(),
        revisedProposalMessageId: z.string().uuid().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type SupplierNegotiationRecord = z.infer<typeof negotiationRecordSchema>;
export type NegotiationOption = z.infer<typeof negotiationOptionSchema>;

export function buildNegotiationRecommendation(input: {
  record: SupplierNegotiationRecord;
  source: "agent" | "deterministic";
  optionId: NegotiationOption["id"];
  decision: SupplierNegotiationRecord["recommendation"] extends infer Recommendation
    ? Recommendation extends { decision: infer Decision }
      ? Decision
      : never
    : never;
  reasonCodes: string[];
  createdAt?: Date;
}): NonNullable<SupplierNegotiationRecord["recommendation"]> {
  if (!input.record.evaluation)
    throw new Error(
      "[internal] Negotiation recommendation requires an evaluation.",
    );
  const option = input.record.evaluation.options.find(
    (candidate) => candidate.id === input.optionId,
  );
  if (!option)
    throw new Error(
      "[internal] Negotiation recommendation option was not found.",
    );
  const requested = input.record.evaluation.options.find(
    (candidate) => candidate.id === "requested",
  );
  const isAgentRecommendation = input.source === "agent";
  const gates = {
    G1: input.record.counterRule?.ok ? ("pass" as const) : ("fail" as const),
    G2: isAgentRecommendation ? ("pass" as const) : ("n/a" as const),
    G3:
      isAgentRecommendation && input.decision !== "escalate"
        ? ("pass" as const)
        : isAgentRecommendation
          ? ("fail" as const)
          : ("n/a" as const),
    G4: option.feasible ? ("pass" as const) : ("fail" as const),
    G5:
      option.policyDecision === "auto_approved"
        ? ("pass" as const)
        : ("fail" as const),
    G6:
      input.record.evaluation.turnAtEvaluation <
      input.record.evaluation.maxTurns
        ? ("pass" as const)
        : ("fail" as const),
    G7: isAgentRecommendation ? ("pass" as const) : ("n/a" as const),
    G8: "pass" as const,
    G9:
      !requested?.feasible ||
      requested.policyDecision !== "auto_approved" ||
      option.id === "requested"
        ? ("pass" as const)
        : ("fail" as const),
  };
  const autoEligible = Object.values(gates).every((gate) => gate === "pass");
  return {
    id: randomUUID(),
    evaluationId: input.record.evaluation.id,
    source: input.source,
    optionId: option.id,
    commitments: option.commitments,
    executionFingerprint: option.executionFingerprint,
    decision: input.decision,
    reasonCodes: input.reasonCodes,
    gates,
    autoEligible,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
}

// H2: needs-human reasons under which a human may approve the active counter's recommendation. Shared by the
// approve command and the detail API so the button and the server can never disagree.
export const APPROVABLE_NEGOTIATION_REASONS: ReadonlySet<string> = new Set([
  "recommendation_ready",
  "recommendation_requires_human",
  "agent_unavailable",
  "agent_timeout",
  "agent_rate_limited",
  "agent_provider_error",
  "agent_invalid_output",
  "agent_refusal",
  "agent_escalated",
  "agent_attempt_limit_reached",
  "agent_daily_limit_reached",
  "auto_negotiation_disabled",
]);

// Revisions held at the hand-off by a switch: recovered with Retry once the switch is back on.
export const HELD_REVISION_REASONS: ReadonlySet<string> = new Set([
  "auto_proposal_disabled_send",
  "auto_negotiation_disabled_send",
]);

export function createNegotiationRecord(): SupplierNegotiationRecord {
  return {
    version: 1,
    counterRule: null,
    evaluation: null,
    agent: {
      state: "not_started",
      nextAttemptNo: 1,
      activeRunId: null,
      skipReason: null,
      attempts: [],
    },
    recommendation: null,
    dispatch: {
      state: "none",
      recommendationId: null,
      revisedProposalMessageId: null,
      source: null,
      dueAt: null,
      heldReason: null,
      handoffCheckedAt: null,
    },
    verdict: null,
  };
}

export function parseNegotiationRecord(
  value: unknown,
): SupplierNegotiationRecord {
  return negotiationRecordSchema.parse(value);
}
