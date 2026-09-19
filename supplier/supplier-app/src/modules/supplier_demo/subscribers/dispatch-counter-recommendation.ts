import { executeSupplierCommand } from "./helpers";

export const metadata = {
  event: "supplier_demo.supply_case.recommendation_ready",
  persistent: true,
  id: "supplier-demo:dispatch-counter-recommendation",
};

export default async function handle(
  payload: Record<string, unknown>,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  if (
    typeof payload.caseId !== "string" ||
    typeof payload.supplyMessageId !== "string"
  )
    return;
  await executeSupplierCommand(
    ctx,
    "supplier_demo.supply_case.approve_counter",
    {
      caseId: payload.caseId,
      supplyMessageId: payload.supplyMessageId,
      source: "auto",
    },
    payload,
  );
}
