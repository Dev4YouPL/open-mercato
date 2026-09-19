import type { AwilixContainer } from "awilix";
import type { EntityManager } from "@mikro-orm/postgresql";
import { runSupplierCounterNegotiation } from "../lib/agent/runner";

export const metadata = {
  event: "supplier_demo.supply_case.counter_evaluated",
  persistent: true,
  id: "supplier-demo:run-counter-agent",
};

export default async function handle(
  payload: Record<string, unknown>,
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  if (
    typeof payload.caseId !== "string" ||
    typeof payload.supplyMessageId !== "string"
  )
    return;
  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.organizationId !== "string"
  )
    return;
  await runSupplierCounterNegotiation({
    em: ctx.resolve<EntityManager>("em"),
    scope: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    },
    caseId: payload.caseId,
    supplyMessageId: payload.supplyMessageId,
    container: ctx as unknown as AwilixContainer,
  });
}
