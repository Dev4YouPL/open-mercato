import type { EntityManager } from "@mikro-orm/postgresql";
import type {
  CommandHandler,
  CommandRuntimeContext,
} from "@open-mercato/shared/lib/commands";
import { registerCommand } from "@open-mercato/shared/lib/commands";
import {
  findOneWithDecryption,
  findWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";
import { SupplyCase, SupplyMessage } from "../data/entities";
import { parseNegotiationRecord } from "../lib/negotiation-record";
import { isAutoNegotiationEnabled } from "../lib/toggles";
import { recoverExpiredSupplierAttempt } from "../lib/agent/attempts";
import { emitSupplierDemoEvent } from "../events";
import { reportSupplierAttemptUsage } from "../lib/agent/usage";

type Scope = { tenantId: string; organizationId: string };

const LOST_EVENT_AFTER_MS = 60_000;

const eventOptions = {
  persistent: true,
  ...({ deliverInline: false } as Record<string, unknown>),
};

function scopeFrom(ctx: CommandRuntimeContext): Scope | null {
  const tenantId = ctx.auth?.tenantId;
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId;
  return tenantId && organizationId ? { tenantId, organizationId } : null;
}

async function backfillUsage(
  em: EntityManager,
  scope: Scope,
  message: SupplyMessage,
): Promise<void> {
  if (!message.negotiationRecord) return;
  const record = parseNegotiationRecord(message.negotiationRecord);
  for (const attempt of record.agent.attempts) {
    if (!attempt.finishedAt || attempt.usageEventId) continue;
    const usageEventId = await reportSupplierAttemptUsage({
      em,
      scope,
      agentId: "supplier_demo.counter_negotiator",
      attempt,
    });
    await em.transactional(async (tx) => {
      await tx
        .getConnection()
        .execute("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
          `supplier_demo.counter_negotiator:${scope.tenantId}`,
        ]);
      const current = await tx.findOne(SupplyMessage, {
        ...scope,
        id: message.id,
        deletedAt: null,
      });
      if (!current?.negotiationRecord) return;
      const currentRecord = parseNegotiationRecord(current.negotiationRecord);
      const stored = currentRecord.agent.attempts.find(
        (candidate) => candidate.runId === attempt.runId,
      );
      if (!stored || stored.usageEventId) return;
      stored.usageEventId = usageEventId;
      current.negotiationRecord = currentRecord;
      await tx.flush();
    });
  }
}

// RCV1-RCV6. The sweep never starts a model call (RCV3): it settles expired leases, back-fills usage rows and
// re-emits lost events for the case's current, undecided counter only. Old, rejected and superseded counters
// are never touched, so a sweep can never pull a case that moved on back into negotiation.
export const recoverCounterProcessing: CommandHandler<
  Record<string, unknown>,
  { recovered: number }
> = {
  id: "supplier_demo.supply_case.recover_counter_processing",
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx);
    if (!scope) return { recovered: 0 };
    const enabled = await isAutoNegotiationEnabled(
      ctx.container,
      scope.tenantId,
    );
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    const requestedCaseId =
      typeof rawInput.caseId === "string" ? rawInput.caseId : null;
    // The selftest simulates a lost event without waiting a minute.
    const lostEventAfterMs =
      typeof rawInput.lostEventAfterMs === "number" && rawInput.lostEventAfterMs >= 0
        ? rawInput.lostEventAfterMs
        : LOST_EVENT_AFTER_MS;
    const cases = await findWithDecryption(
      em,
      SupplyCase,
      {
        ...scope,
        ...(requestedCaseId ? { id: requestedCaseId } : {}),
        status: "counter_received",
        deletedAt: null,
      },
      { limit: 50 },
      scope,
    );
    let recovered = 0;
    for (const supplyCase of cases) {
      const counter = (
        await findWithDecryption(
          em,
          SupplyMessage,
          {
            ...scope,
            supplyCaseId: supplyCase.id,
            direction: "inbound",
            messageType: "SUPPLY_COUNTER_PROPOSAL",
            validationStatus: "valid",
            deletedAt: null,
          },
          { orderBy: { createdAt: "desc" } },
          scope,
        )
      )[0];
      if (!counter) continue;
      if (
        await recoverExpiredSupplierAttempt({
          em,
          scope,
          caseId: supplyCase.id,
          supplyMessageId: counter.id,
        })
      ) {
        await emitSupplierDemoEvent(
          "supplier_demo.supply_case.attention_required",
          { ...scope, caseId: supplyCase.id, reason: "agent_timeout", status: "needs_human" },
          eventOptions,
        );
        recovered += 1;
        continue;
      }
      const fresh = await findOneWithDecryption(
        em.fork(),
        SupplyMessage,
        { ...scope, id: counter.id, deletedAt: null },
        undefined,
        scope,
      );
      if (!fresh?.negotiationRecord) continue;
      const record = parseNegotiationRecord(fresh.negotiationRecord);
      if (record.verdict) continue;
      // Only intents that stayed unconsumed for a while are treated as lost; a normal hand-off takes seconds.
      const overdue = (at: string | null | undefined) =>
        !at || Date.now() - new Date(at).getTime() > lostEventAfterMs;
      if (!overdue(record.evaluation?.evaluatedAt ?? fresh.receivedAt?.toISOString()))
        continue;
      if (record.dispatch.state === "pending" && !overdue(record.dispatch.dueAt))
        continue;
      if (!record.evaluation) {
        // RCV4: the evaluation itself was lost.
        await emitSupplierDemoEvent(
          "supplier_demo.supply_case.counter_received",
          { ...scope, caseId: supplyCase.id, supplyMessageId: counter.id },
          eventOptions,
        );
        recovered += 1;
      } else if (
        enabled &&
        record.agent.state === "not_started" &&
        !record.recommendation
      ) {
        // RCV4: the dispatch to the agent subscriber was lost; the subscriber claims (and caps) atomically.
        await emitSupplierDemoEvent(
          "supplier_demo.supply_case.counter_evaluated",
          { ...scope, caseId: supplyCase.id, supplyMessageId: counter.id, evaluationId: record.evaluation.id },
          eventOptions,
        );
        recovered += 1;
      } else if (
        record.dispatch.state === "pending" &&
        record.recommendation?.autoEligible
      ) {
        // RCV4: the auto-send intent is durable; re-emit the same recommendation (disposition is idempotent).
        await emitSupplierDemoEvent(
          "supplier_demo.supply_case.recommendation_ready",
          {
            ...scope,
            caseId: supplyCase.id,
            supplyMessageId: counter.id,
            recommendationId: record.recommendation.id,
            evaluationId: record.recommendation.evaluationId,
            autoEligible: true,
          },
          eventOptions,
        );
        recovered += 1;
      }
    }
    // Usage rows for finished attempts whose report failed earlier (bounded to the most recent counters).
    const recentCounters = await findWithDecryption(
      em,
      SupplyMessage,
      {
        ...scope,
        direction: "inbound",
        messageType: "SUPPLY_COUNTER_PROPOSAL",
        validationStatus: "valid",
        deletedAt: null,
      },
      { orderBy: { createdAt: "desc" }, limit: 50 },
      scope,
    );
    for (const message of recentCounters) await backfillUsage(em, scope, message);
    return { recovered };
  },
};

registerCommand(recoverCounterProcessing);
