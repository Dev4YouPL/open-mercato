import { createHash } from "node:crypto";
import type { AwilixContainer } from "awilix";
import { SUPPLIER_COUNTER_RECOVERY_QUEUE } from "../workers/counter-recovery";

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>;
};

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash("sha256").update(stableKey).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function registerSupplierCounterRecoverySchedule(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  const resolver = container as AwilixContainer & {
    hasRegistration?: (name: string) => boolean;
  };
  if (
    typeof resolver.hasRegistration !== "function" ||
    !resolver.hasRegistration("schedulerService")
  )
    return false;
  const schedulerService = container.resolve(
    "schedulerService",
  ) as SchedulerServiceLike;
  await schedulerService.register({
    id: stableScheduleUuid(
      `supplier_demo:counter-recovery:${scope.tenantId}:${scope.organizationId}`,
    ),
    name: "Supplier Demo counter negotiation recovery",
    description:
      "Recover stale supplier counter negotiation attempts and replay missed agent dispatches.",
    scopeType: "organization",
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scheduleType: "interval",
    scheduleValue: "1m",
    timezone: "UTC",
    targetType: "queue",
    targetQueue: SUPPLIER_COUNTER_RECOVERY_QUEUE,
    targetPayload: scope,
    sourceType: "module",
    sourceModule: "supplier_demo",
    isEnabled: true,
  });
  return true;
}
