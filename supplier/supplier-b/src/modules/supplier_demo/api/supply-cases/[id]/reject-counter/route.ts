import type { CommandRuntimeContext } from "@open-mercato/shared/lib/commands";
import { z } from "zod";
import {
  createMutationContext,
  commandErrorResponse,
  readBody,
  responseFromCommand,
} from "../../route-utils";

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ["supplier_demo.supply_cases.manage"],
  },
};
const bodySchema = z.object({
  supplyMessageId: z.string().uuid(),
  updatedAt: z.string().datetime(),
  // Pins the decision to the recommendation the operator saw; a changed recommendation returns 409.
  recommendationId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readBody(req));
  if (!parsed.success)
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  const prepared = await createMutationContext(
    req,
    "supplier_demo:supply_case",
    "custom",
    { id, ...parsed.data },
    id,
  );
  if ("response" in prepared) return prepared.response;
  try {
    const result = await prepared.container
      .resolve<{
        execute: (
          commandId: string,
          options: { input: unknown; ctx: CommandRuntimeContext },
        ) => Promise<{ result: unknown }>;
      }>("commandBus")
      .execute("supplier_demo.supply_case.reject_counter", {
        input: {
          caseId: id,
          supplyMessageId: parsed.data.supplyMessageId,
          updatedAt: new Date(parsed.data.updatedAt),
          recommendationId: parsed.data.recommendationId,
          reason: parsed.data.reason,
        },
        ctx: prepared.ctx,
      });
    await prepared.guardResult.runAfterSuccess();
    return responseFromCommand(result, 202);
  } catch (error) {
    return commandErrorResponse(error);
  }
}

export const openApi = {
  tags: ["Supplier Demo"],
  methods: {
    POST: {
      summary: "Reject a supplier counter",
      tags: ["Supplier Demo"],
      requestBody: { schema: bodySchema },
      responses: [
        { status: 202, description: "Counter rejected" },
        { status: 409, description: "Case changed" },
      ],
    },
  },
};
