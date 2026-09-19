import { randomUUID } from "node:crypto";
import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type {
  CommandHandler,
  CommandRuntimeContext,
} from "@open-mercato/shared/lib/commands";
import { registerCommand } from "@open-mercato/shared/lib/commands";
import { CrudHttpError, notFound } from "@open-mercato/shared/lib/crud/errors";
import {
  findOneWithDecryption,
  findWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";
import {
  SupplyCase,
  SupplyMessage,
  SupplierProductionSlot,
} from "../data/entities";
import { emitSupplierDemoEvent } from "../events";
import {
  buildSupplyEnvelope,
  counterPayloadSchema,
  stripEnvelopeAddresses,
} from "../lib/envelope";
import { evaluateCounter } from "../lib/counter-evaluation";
import {
  APPROVABLE_NEGOTIATION_REASONS,
  parseNegotiationRecord,
  type NegotiationOption,
} from "../lib/negotiation-record";
import { finalizeSupplierCounterAttempt } from "../lib/agent/attempts";
import { parseSupplierAgentConfig } from "../lib/agent/config";
import { isAutoNegotiationEnabled } from "../lib/toggles";

type Scope = { tenantId: string; organizationId: string };

type Disposition = {
  status: string;
  revisedProposalMessageId?: string;
  // Set when the command itself moved the case to needs_human (automatic path only): the operator is notified.
  attentionReason?: string;
};

const eventOptions = {
  persistent: true,
  ...({ deliverInline: false } as Record<string, unknown>),
};

function scopeFrom(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId;
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId;
  if (!tenantId || !organizationId)
    throw new CrudHttpError(401, { error: "Unauthorized" });
  return { tenantId, organizationId };
}

function actorFrom(ctx: CommandRuntimeContext): string {
  return typeof ctx.auth?.sub === "string" && ctx.auth.sub
    ? ctx.auth.sub
    : "supplier-demo-system";
}

function expectedVersion(rawInput: Record<string, unknown>): Date {
  // Routes pass a Date; String(Date) would drop the milliseconds and make every version check fail.
  const value =
    rawInput.updatedAt instanceof Date
      ? rawInput.updatedAt
      : new Date(String(rawInput.updatedAt ?? ""));
  if (Number.isNaN(value.getTime()))
    throw new CrudHttpError(422, { error: "updatedAt is required" });
  return value;
}

function unprocessable(code: string, error: string): CrudHttpError {
  return new CrudHttpError(422, { error, code });
}

async function isLatestValidCounter(
  tx: EntityManager,
  scope: Scope,
  caseId: string,
  counterId: string,
): Promise<boolean> {
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
  return counters[0]?.id === counterId;
}

// Applies the plan's allocation moves to the locked slot rows. Arrays are replaced (not mutated in place) so the
// ORM sees the json change.
function applyMovedAllocations(
  slots: SupplierProductionSlot[],
  option: NegotiationOption,
): void {
  for (const move of option.movedAllocations) {
    const from = slots.find((slot) => slot.id === move.fromSlotId);
    const to = slots.find((slot) => slot.id === move.toSlotId);
    const index =
      from?.allocations.findIndex(
        (allocation) =>
          allocation.orderNumber === move.orderNumber &&
          Number(allocation.quantity) === move.quantity,
      ) ?? -1;
    if (!from || !to || index < 0)
      throw new CrudHttpError(409, {
        error: "Production slots changed; evaluate the counter again",
        code: "recommendation_stale",
      });
    const allocation = from.allocations[index];
    from.allocations = from.allocations.filter(
      (_, position) => position !== index,
    );
    to.allocations = [...to.allocations, { ...allocation }];
    from.updatedAt = new Date();
    to.updatedAt = new Date();
  }
}

const approveCounter: CommandHandler<Record<string, unknown>, Disposition> = {
  id: "supplier_demo.supply_case.approve_counter",
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx);
    const caseId = typeof rawInput.caseId === "string" ? rawInput.caseId : null;
    const counterId =
      typeof rawInput.supplyMessageId === "string"
        ? rawInput.supplyMessageId
        : null;
    const expectedRecommendationId =
      typeof rawInput.recommendationId === "string"
        ? rawInput.recommendationId
        : null;
    if (!caseId || !counterId)
      throw new CrudHttpError(422, { error: "Case and counter are required" });
    const automatic = rawInput.source === "auto" && ctx.systemActor === true;
    const version = automatic ? null : expectedVersion(rawInput);
    // G7 is re-checked at disposition time: a switch turned off after the agent run must stop the send.
    const negotiationEnabled = automatic
      ? await isAutoNegotiationEnabled(ctx.container, scope.tenantId)
      : true;
    const config = parseSupplierAgentConfig();
    const maxTurns = config.ok ? config.config.maxNegotiationTurns : 3;
    const em = ctx.container.resolve("em") as EntityManager;
    const outcome = await em.transactional(async (tx): Promise<Disposition> => {
      // Lock order: case first, then the fresh counter row, then the slots (spec "Attempt identity, locks").
      const supplyCase = await findOneWithDecryption(
        tx,
        SupplyCase,
        { ...scope, id: caseId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      );
      const counter = await findOneWithDecryption(
        tx,
        SupplyMessage,
        {
          ...scope,
          id: counterId,
          supplyCaseId: caseId,
          direction: "inbound",
          messageType: "SUPPLY_COUNTER_PROPOSAL",
          validationStatus: "valid",
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      );
      if (!supplyCase || !counter?.negotiationRecord)
        throw notFound("Counter not found");
      if (version && supplyCase.updatedAt.getTime() !== version.getTime())
        throw new CrudHttpError(409, {
          error: "Supply case was changed by another user",
        });
      const record = parseNegotiationRecord(counter.negotiationRecord);
      // An automatic replay of an already disposed counter is a no-op; a human gets an explicit answer.
      if (record.verdict) {
        if (automatic)
          return {
            status: supplyCase.status,
            revisedProposalMessageId:
              record.verdict.revisedProposalMessageId ?? undefined,
          };
        throw unprocessable("already_disposed", "The counter was already decided");
      }
      const recommendation = record.recommendation;
      const expectedStatus = automatic
        ? supplyCase.status === "counter_received" &&
          record.dispatch.state === "pending" &&
          recommendation?.source === "agent" &&
          recommendation.autoEligible
        : supplyCase.status === "needs_human" &&
          APPROVABLE_NEGOTIATION_REASONS.has(supplyCase.statusReason ?? "");
      const active = await isLatestValidCounter(tx, scope, caseId, counterId);
      if (!expectedStatus || !active || !recommendation || !record.evaluation) {
        if (automatic) return { status: supplyCase.status };
        throw unprocessable("not_approvable", "The counter has no approvable recommendation");
      }
      if (
        expectedRecommendationId &&
        expectedRecommendationId !== recommendation.id
      )
        throw new CrudHttpError(409, {
          error: "The recommendation changed; review it again",
          code: "recommendation_changed",
        });
      const settle = (reason: string): Disposition => {
        // Automatic path only: never throw from the auto-send subscriber for a business condition, and never
        // leave the case waiting on a dispatch that can no longer happen.
        record.dispatch = {
          ...record.dispatch,
          state: "none",
          source: null,
          heldReason: reason,
        };
        counter.negotiationRecord = record;
        supplyCase.status = "needs_human";
        supplyCase.statusReason = reason;
        supplyCase.updatedAt = new Date();
        return { status: supplyCase.status, attentionReason: reason };
      };
      if (automatic && !negotiationEnabled) {
        const result = settle("auto_negotiation_disabled");
        await tx.flush();
        return result;
      }
      const parsedPayload = counterPayloadSchema.safeParse(
        counter.envelopePayload?.payload,
      );
      if (!parsedPayload.success)
        throw unprocessable("counter_invalid_schema", "Counter payload is not valid v2");
      const slots = await tx.find(
        SupplierProductionSlot,
        {
          ...scope,
          catalogVariantId: supplyCase.catalogVariantId,
          deletedAt: null,
        },
        // Same ordering as evaluate_counter, so the re-evaluation reproduces the recorded fingerprint.
        { orderBy: { startsAt: "asc" }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      // H4/G4/G5/G6/G9 on the locked, current state: the evaluation the recommendation was built on must still
      // produce the identical plan (same commitments, moves, cost and risk).
      const freshEvaluation = evaluateCounter({
        requested: parsedPayload.data.requestedCommitments,
        current: supplyCase.currentCommitment,
        originalDate: supplyCase.originalCommitment[0]?.date ?? null,
        warehouseReserved:
          supplyCase.baselineCommitment.find(
            (entry) => entry.date === supplyCase.originalCommitment[0]?.date,
          )?.quantity ?? 0,
        slots,
        caseOrderNumber: supplyCase.orderNumber,
        negotiationTurn: supplyCase.negotiationTurn,
        maxTurns,
        cumulativeCost: Number(supplyCase.additionalCost ?? 0),
      });
      if (!freshEvaluation.rule.ok && freshEvaluation.rule.failed === "T1") {
        if (automatic) {
          const result = settle("negotiation_turn_limit_reached");
          await tx.flush();
          return result;
        }
        throw unprocessable("turn_limit_reached", "Negotiation turn limit reached");
      }
      const selectedOption = freshEvaluation.options.find(
        (option) => option.id === recommendation.optionId,
      );
      if (
        !freshEvaluation.rule.ok ||
        !selectedOption ||
        !selectedOption.feasible ||
        selectedOption.executionFingerprint !==
          recommendation.executionFingerprint
      ) {
        if (automatic) {
          const result = settle("recommendation_stale");
          await tx.flush();
          return result;
        }
        throw unprocessable("recommendation_stale", "Counter plan changed; evaluate the counter again");
      }
      if (automatic) {
        const requested = freshEvaluation.options.find(
          (option) => option.id === "requested",
        );
        const requestedAuto =
          requested?.feasible && requested.policyDecision === "auto_approved";
        if (
          selectedOption.policyDecision !== "auto_approved" ||
          (requestedAuto && selectedOption.id !== "requested")
        ) {
          const result = settle("recommendation_requires_human");
          await tx.flush();
          return result;
        }
      }
      applyMovedAllocations(slots, selectedOption);
      const messageId = randomUUID();
      const businessMessageId = `MSG-${messageId}`;
      const negotiationTurn = supplyCase.negotiationTurn + 1;
      const envelope = buildSupplyEnvelope({
        messageId: businessMessageId,
        correlationId: supplyCase.correlationId,
        sender: "supplier-demo@localhost",
        recipient: supplyCase.recipientEmail ?? "supplier-demo@example.invalid",
        sku: supplyCase.sku,
        commitments: selectedOption.commitments,
        inReplyToMessageId: counter.businessMessageId,
        negotiationTurn,
      });
      const now = new Date();
      const revision = tx.create(SupplyMessage, {
        id: messageId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplyCaseId: caseId,
        businessMessageId,
        direction: "outbound",
        messageType: "SUPPLY_PROPOSAL",
        inReplyToBusinessId: counter.businessMessageId,
        recipientEmail: supplyCase.recipientEmail,
        subject: `Re: [${supplyCase.correlationId}] Delivery update — ${supplyCase.sku}`,
        envelopePayload: stripEnvelopeAddresses(envelope),
        deliveryStatus: "pending",
        duplicateCount: 0,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      record.verdict = {
        kind: automatic ? "auto_approved" : "approved",
        by: automatic ? "rule:supplier_policy" : actorFrom(ctx),
        at: now.toISOString(),
        reason: automatic
          ? "auto_approved_counter_recommendation"
          : "human_approved_counter_recommendation",
        revisedProposalMessageId: revision.id,
      };
      record.dispatch = {
        ...record.dispatch,
        state: "revision_pending",
        recommendationId: recommendation.id,
        revisedProposalMessageId: revision.id,
        source: automatic ? "auto" : "human",
        heldReason: null,
      };
      counter.negotiationRecord = record;
      supplyCase.currentCommitment = selectedOption.commitments.map(
        (commitment) => ({ ...commitment }),
      );
      supplyCase.negotiationTurn = negotiationTurn;
      supplyCase.additionalCost = (
        Number(supplyCase.additionalCost ?? 0) + selectedOption.incrementalCost
      ).toFixed(2);
      supplyCase.status = "proposal_ready";
      supplyCase.statusReason = null;
      supplyCase.updatedAt = now;
      tx.persist(revision);
      await tx.flush();
      return {
        status: supplyCase.status,
        revisedProposalMessageId: revision.id,
      };
    });
    if (outcome.attentionReason)
      await emitSupplierDemoEvent(
        "supplier_demo.supply_case.attention_required",
        { ...scope, caseId, reason: outcome.attentionReason, status: outcome.status },
        eventOptions,
      );
    if (outcome.status === "proposal_ready" && outcome.revisedProposalMessageId)
      await emitSupplierDemoEvent(
        "supplier_demo.supply_case.proposal_ready",
        { ...scope, caseId, supplyMessageId: outcome.revisedProposalMessageId },
        eventOptions,
      );
    return outcome;
  },
};

const rejectCounter: CommandHandler<
  Record<string, unknown>,
  { status: string; reason: string }
> = {
  id: "supplier_demo.supply_case.reject_counter",
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx);
    const caseId = typeof rawInput.caseId === "string" ? rawInput.caseId : null;
    const counterId =
      typeof rawInput.supplyMessageId === "string"
        ? rawInput.supplyMessageId
        : null;
    if (!caseId || !counterId)
      throw new CrudHttpError(422, { error: "Case and counter are required" });
    const version = expectedVersion(rawInput);
    const em = ctx.container.resolve("em") as EntityManager;
    const result = await em.transactional(async (tx) => {
      const supplyCase = await findOneWithDecryption(
        tx,
        SupplyCase,
        { ...scope, id: caseId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      );
      const counter = await findOneWithDecryption(
        tx,
        SupplyMessage,
        {
          ...scope,
          id: counterId,
          supplyCaseId: caseId,
          direction: "inbound",
          messageType: "SUPPLY_COUNTER_PROPOSAL",
          validationStatus: "valid",
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      );
      if (!supplyCase || !counter?.negotiationRecord)
        throw notFound("Counter not found");
      if (supplyCase.updatedAt.getTime() !== version.getTime())
        throw new CrudHttpError(409, {
          error: "Supply case was changed by another user",
        });
      const record = parseNegotiationRecord(counter.negotiationRecord);
      if (record.verdict?.kind === "rejected")
        return { runId: null, changed: false };
      if (
        typeof rawInput.recommendationId === "string" &&
        rawInput.recommendationId !== record.recommendation?.id
      )
        throw new CrudHttpError(409, {
          error: "The recommendation changed; review it again",
          code: "recommendation_changed",
        });
      // An approved counter already has a queued revision; rejecting it now would regress the case.
      if (record.verdict)
        throw unprocessable("already_disposed", "The counter was already decided");
      if (
        !["counter_received", "needs_human"].includes(supplyCase.status) ||
        !(await isLatestValidCounter(tx, scope, caseId, counterId))
      )
        throw unprocessable("not_rejectable", "Only the current counter can be rejected");
      const runId = record.agent.activeRunId;
      record.verdict = {
        kind: "rejected",
        by: actorFrom(ctx),
        at: new Date().toISOString(),
        reason:
          typeof rawInput.reason === "string" && rawInput.reason.trim()
            ? rawInput.reason.trim().slice(0, 500)
            : "human_rejected_counter",
        revisedProposalMessageId: null,
      };
      record.dispatch = {
        ...record.dispatch,
        state: "none",
        heldReason: "counter_rejected",
        source: "human",
      };
      counter.negotiationRecord = record;
      supplyCase.status = "needs_human";
      supplyCase.statusReason = record.recommendation
        ? "recommendation_rejected"
        : "counter_rejected";
      supplyCase.updatedAt = new Date();
      await tx.flush();
      return { runId, changed: true, reason: supplyCase.statusReason };
    });
    // A still-running model call is closed as cancelled; its late result can no longer touch the case.
    if (result.runId)
      await finalizeSupplierCounterAttempt({
        em,
        scope,
        caseId,
        supplyMessageId: counterId,
        runId: result.runId,
        result: {
          output: null,
          outcome: "cancelled",
          errorCode: "rejected_by_user",
          finishReason: "cancelled",
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: null },
          providerRequestCount: 0,
        },
      });
    const reason = "reason" in result && result.reason ? result.reason : "counter_rejected";
    if (result.changed)
      await emitSupplierDemoEvent(
        "supplier_demo.supply_case.attention_required",
        { ...scope, caseId, reason, status: "needs_human" },
        eventOptions,
      );
    return { status: "needs_human", reason };
  },
};

registerCommand(approveCounter);
registerCommand(rejectCounter);
