import { z } from "zod";
import type { JobContext, QueuedJob, WorkerMeta } from "@open-mercato/queue";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { executeSupplierCommand } from "../subscribers/helpers";

export const SUPPLIER_COUNTER_RECOVERY_QUEUE = "supplier-demo-counter-recovery";

const payloadSchema = z
  .object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

export const metadata: WorkerMeta = {
  queue: SUPPLIER_COUNTER_RECOVERY_QUEUE,
  id: "supplier-demo:counter-recovery",
  concurrency: 1,
};

export default async function handle(
  job: QueuedJob<Record<string, unknown>>,
  _ctx: JobContext,
): Promise<void> {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) return;
  const container = await createRequestContainer();
  await executeSupplierCommand(
    container,
    "supplier_demo.supply_case.recover_counter_processing",
    {},
    parsed.data,
  );
}
