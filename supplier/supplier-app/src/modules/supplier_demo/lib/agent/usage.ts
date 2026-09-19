import type { EntityManager } from "@mikro-orm/postgresql";
import { AiTokenUsageEvent } from "@open-mercato/ai-assistant/modules/ai_assistant/data/entities";
import { AiTokenUsageRepository } from "@open-mercato/ai-assistant/modules/ai_assistant/data/repositories/AiTokenUsageRepository";
import { reportError } from "@open-mercato/telemetry";
import type { SupplierNegotiationRecord } from "../negotiation-record";

export const SUPPLIER_SYSTEM_USAGE_USER_ID =
  "00000000-0000-0000-0000-000000000000";

export async function reportSupplierAttemptUsage(input: {
  em: EntityManager;
  scope: { tenantId: string; organizationId: string };
  agentId: string;
  attempt: SupplierNegotiationRecord["agent"]["attempts"][number];
}): Promise<string> {
  return input.em.transactional(async (tx) => {
    await tx
      .getConnection()
      .execute("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
        `supplier_demo.counter_negotiator:${input.scope.tenantId}`,
      ]);
    const existing = await tx.findOne(AiTokenUsageEvent, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      sessionId: input.attempt.runId,
      agentId: input.agentId,
    });
    if (existing) return existing.id;

    const repository = new AiTokenUsageRepository(tx);
    const event = await repository.createEvent({
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      userId: SUPPLIER_SYSTEM_USAGE_USER_ID,
      agentId: input.agentId,
      moduleId: "supplier_demo",
      sessionId: input.attempt.runId,
      turnId: input.attempt.runId,
      stepIndex: 0,
      providerId:
        input.attempt.effectiveProvider ?? input.attempt.configuredProvider,
      modelId: input.attempt.effectiveModel ?? input.attempt.configuredModel,
      inputTokens: input.attempt.usage.inputTokens,
      outputTokens: input.attempt.usage.outputTokens,
      reasoningTokens: input.attempt.usage.reasoningTokens,
      finishReason: input.attempt.finishReason,
      loopAbortReason:
        input.attempt.outcome === "timeout" ? "budget-wall-clock" : null,
    });
    await repository.upsertDaily({
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      day:
        input.attempt.finishedAt?.slice(0, 10) ??
        new Date().toISOString().slice(0, 10),
      agentId: input.agentId,
      modelId: input.attempt.effectiveModel ?? input.attempt.configuredModel,
      providerId:
        input.attempt.effectiveProvider ?? input.attempt.configuredProvider,
      sessionId: input.attempt.runId,
      inputTokens: input.attempt.usage.inputTokens,
      outputTokens: input.attempt.usage.outputTokens,
      cachedInputTokens: 0,
      reasoningTokens: input.attempt.usage.reasoningTokens ?? 0,
    });
    return event.id;
  });
}

export function reportSupplierUsageError(error: unknown, runId: string): void {
  reportError(error, {
    module: "supplier_demo",
    code: "supplier_demo.usage_report_failed",
    attributes: { runId },
  });
}
