import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/postgresql";
import type {
  CommandBus,
  CommandRuntimeContext,
} from "@open-mercato/shared/lib/commands";
import {
  findOneWithDecryption,
  findWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";
import { CatalogProductVariant } from "@open-mercato/core/modules/catalog/data/entities";
import { SalesOrder } from "@open-mercato/core/modules/sales/data/entities";
import { FeatureToggle } from "@open-mercato/core/modules/feature_toggles/data/entities";
import {
  SupplyCase,
  SupplyMessage,
  type SupplyCommitment,
} from "../../data/entities";
import { SupplierProductionSlot } from "../../data/entities";
import { renderSupplyEnvelope, type SupplyEnvelope } from "../../lib/envelope";
import { evaluateCounter } from "../../lib/counter-evaluation";
import { resolveMailboxPollChannel } from "../../lib/mailbox";
import { runSupplierCounterNegotiation } from "../../lib/agent/runner";
import { runAiAgentObject } from "@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime";
import { claimSupplierCounterAttempt } from "../../lib/agent/attempts";
import { buildSupplierCounterAgentInput } from "../../lib/agent/input";
import {
  supplierDemoNegotiationToggleId,
  supplierDemoToggleId,
} from "../../lib/toggles";
import { ensureDemoProductionSlots } from "../../setup";

type SupplierSelftestScope = { tenantId: string; organizationId: string };
type SelftestMode =
  | "loop-real"
  | "level3-fallback"
  | "counter-eval"
  | "agent-stub"
  | "agent-decline"
  | "initial-high-priority"
  | "approve-reject"
  | "crash-recovery"
  | "reopen-recovery"
  | "usage-caps"
  | "concurrent-approve"
  | "send-toggle"
  | "proposal-send-toggle"
  | "auto-recovery";

type SelftestInput = {
  em: EntityManager;
  commandBus: CommandBus;
  container: CommandRuntimeContext["container"];
  scope: SupplierSelftestScope;
  mode: SelftestMode;
};

function commandContext(
  container: CommandRuntimeContext["container"],
  scope: SupplierSelftestScope,
): CommandRuntimeContext {
  return {
    container,
    auth: {
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext["auth"],
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  };
}

function executionResult(execution: unknown): Record<string, unknown> {
  if (!execution || typeof execution !== "object") return {};
  const result = (execution as { result?: unknown }).result;
  return result && typeof result === "object"
    ? (result as Record<string, unknown>)
    : {};
}

function commitment(quantity: number, date: string): SupplyCommitment {
  return { quantity, date };
}

async function fixture(em: EntityManager, scope: SupplierSelftestScope) {
  const order = (
    await findWithDecryption(
      em,
      SalesOrder,
      { ...scope, deletedAt: null, orderNumber: { $like: "SO-441%" } },
      { orderBy: { createdAt: "desc" } },
      scope,
    )
  ).find(
    (candidate) => !["canceled", "cancelled"].includes(candidate.status ?? ""),
  );
  const variant = await em.findOne(CatalogProductVariant, {
    ...scope,
    sku: "MAT-42",
    deletedAt: null,
  });
  if (!order || !variant)
    throw new Error(
      "[internal] Supplier real-path selftest fixture is incomplete; run demo:reset first.",
    );
  const existing = await em.findOne(SupplyCase, {
    ...scope,
    salesOrderId: order.id,
    deletedAt: null,
  });
  if (existing)
    throw new Error(
      "[internal] Supplier real-path selftest requires a resettable tenant; run demo:reset first.",
    );
  return { order, variant };
}

async function cleanup(
  em: EntityManager,
  scope: SupplierSelftestScope,
  orderId: string,
): Promise<void> {
  const cases = await em.find(SupplyCase, {
    ...scope,
    salesOrderId: orderId,
    deletedAt: null,
  });
  const caseIds = cases.map((record) => record.id);
  if (!caseIds.length) return;
  for (const message of await em.find(SupplyMessage, {
    ...scope,
    supplyCaseId: { $in: caseIds },
    deletedAt: null,
  }))
    message.deletedAt = new Date();
  for (const record of cases) record.deletedAt = new Date();
  await em.flush();
}

async function runLoopReal(
  input: SelftestInput,
  orderId: string,
  variantId: string,
): Promise<void> {
  const ctx = commandContext(input.container, input.scope);
  const execution = await input.commandBus.execute(
    "supplier_demo.supply_case.open_from_shortfall",
    {
      input: {
        salesOrderId: orderId,
        orderNumber: (await input.em.findOne(SalesOrder, { id: orderId }))
          ?.orderNumber,
        shortfalls: [
          {
            catalogVariantId: variantId,
            requiredQuantity: 500,
            reservedQuantity: 300,
            shortfallQuantity: 200,
          },
        ],
        trigger: "wms_shortfall",
      },
      ctx,
    },
  );
  if (executionResult(execution).status !== "proposal_ready")
    throw new Error(
      `[internal] real-path loop did not create a proposal-ready case: ${JSON.stringify(executionResult(execution))}.`,
    );
  const supplyCase = await findOneWithDecryption(
    input.em,
    SupplyCase,
    { ...input.scope, salesOrderId: orderId, deletedAt: null },
    undefined,
    input.scope,
  );
  if (!supplyCase || supplyCase.status !== "proposal_ready")
    throw new Error("[internal] real-path loop case state was not persisted.");
  const proposal = await findOneWithDecryption(
    input.em,
    SupplyMessage,
    {
      ...input.scope,
      supplyCaseId: supplyCase.id,
      direction: "outbound",
      messageType: "SUPPLY_PROPOSAL",
      deletedAt: null,
    },
    { orderBy: { createdAt: "desc" } },
    input.scope,
  );
  if (!proposal || proposal.deliveryStatus !== "pending")
    throw new Error(
      "[internal] real-path loop proposal fixture was not persisted as pending.",
    );
}

async function runLevel3Fallback(
  input: SelftestInput,
  orderId: string,
  variantId: string,
  orderNumber: string,
): Promise<void> {
  const ctx = commandContext(input.container, input.scope);
  await input.commandBus.execute(
    "supplier_demo.supply_case.open_from_shortfall",
    {
      input: {
        salesOrderId: orderId,
        orderNumber,
        shortfalls: [
          {
            catalogVariantId: variantId,
            requiredQuantity: 500,
            reservedQuantity: 300,
            shortfallQuantity: 200,
          },
        ],
        trigger: "wms_shortfall",
      },
      ctx,
    },
  );
  const supplyCase = await findOneWithDecryption(
    input.em,
    SupplyCase,
    { ...input.scope, salesOrderId: orderId, deletedAt: null },
    undefined,
    input.scope,
  );
  if (!supplyCase)
    throw new Error("[internal] Level 3 fallback case was not persisted.");
  const proposal = await findOneWithDecryption(
    input.em,
    SupplyMessage,
    {
      ...input.scope,
      supplyCaseId: supplyCase.id,
      direction: "outbound",
      messageType: "SUPPLY_PROPOSAL",
      deletedAt: null,
    },
    { orderBy: { createdAt: "desc" } },
    input.scope,
  );
  if (!proposal)
    throw new Error("[internal] Level 3 fallback proposal was not persisted.");

  proposal.deliveryStatus = "delivered";
  supplyCase.status = "proposal_delivered";
  await input.em.flush();

  const first = supplyCase.currentCommitment[0];
  if (!first)
    throw new Error("[internal] Level 3 fallback commitment fixture is empty.");
  const accepted = [commitment(first.quantity, first.date)];
  const cancelled = supplyCase.currentCommitment
    .slice(1)
    .map((entry) => commitment(entry.quantity, entry.date));
  const envelope: Extract<
    SupplyEnvelope,
    { messageType: "SUPPLY_ACCEPTANCE" }
  > = {
    schemaVersion: 1,
    messageId: `SELFTEST-${randomUUID()}`,
    correlationId: supplyCase.correlationId,
    messageType: "SUPPLY_ACCEPTANCE",
    sender: supplyCase.recipientEmail ?? "manufacturer-a@example.test",
    recipient:
      proposal.senderEmail ??
      process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ??
      "supplier-demo@example.test",
    payload: {
      sku: supplyCase.sku,
      inReplyToMessageId: proposal.businessMessageId,
      acceptedCommitments: accepted,
      cancelledCommitments: cancelled,
    },
  };
  const channel = await resolveMailboxPollChannel({
    em: input.em,
    expectedScope: input.scope,
  });
  const externalMessageId = `selftest-${randomUUID()}@supplier-demo.local`;
  const ingested = await input.commandBus.execute(
    "communication_channels.message.ingest_inbound",
    {
      input: {
        channelId: channel.id,
        providerKey: "imap",
        channelType: "email",
        scope: input.scope,
        message: {
          externalMessageId,
          externalConversationId: `selftest-thread-${supplyCase.id}`,
          senderIdentifier: envelope.sender,
          subject: `Re: [${supplyCase.correlationId}] Delivery update — ${supplyCase.sku}`,
          body: `Local selftest reply.\n\n${renderSupplyEnvelope(envelope)}`,
          bodyFormat: "text",
          timestamp: new Date(),
          channelPayload: {
            from: envelope.sender,
            to: envelope.recipient,
            messageId: externalMessageId,
          },
          channelContentType: "text/plain",
          channelMetadata: { messageId: externalMessageId },
        },
      },
      ctx,
    },
  );
  const ingestResult = executionResult(ingested);
  if (typeof ingestResult.channelLinkId !== "string")
    throw new Error(
      "[internal] installed inbound ingest did not return a channel link.",
    );
  await input.commandBus.execute(
    "supplier_demo.supply_message.receive_inbound",
    {
      input: {
        channelLinkId: ingestResult.channelLinkId,
        messageId: ingestResult.messageId,
        externalMessageId: ingestResult.externalMessageId,
      },
      ctx,
    },
  );
  const acceptance = await findOneWithDecryption(
    input.em,
    SupplyMessage,
    {
      ...input.scope,
      supplyCaseId: supplyCase.id,
      direction: "inbound",
      messageType: "SUPPLY_ACCEPTANCE",
      validationStatus: "valid",
      deletedAt: null,
    },
    undefined,
    input.scope,
  );
  if (!acceptance)
    throw new Error(
      "[internal] installed inbound ingest did not persist a valid acceptance.",
    );
  await input.commandBus.execute("supplier_demo.supply_case.apply_acceptance", {
    input: { caseId: supplyCase.id, supplyMessageId: acceptance.id },
    ctx,
  });
  const applied = await findOneWithDecryption(
    input.em,
    SupplyCase,
    { ...input.scope, id: supplyCase.id, deletedAt: null },
    undefined,
    input.scope,
  );
  if (!applied || applied.status !== "commitment_updated")
    throw new Error(
      "[internal] Level 3 fallback did not apply the persisted acceptance.",
    );
}

async function runHighPriorityInitialPlan(
  input: SelftestInput,
  orderId: string,
  variantId: string,
  orderNumber: string,
): Promise<void> {
  const ctx = commandContext(input.container, input.scope);
  const order442 = (
    await findWithDecryption(
      input.em,
      SalesOrder,
      { ...input.scope, orderNumber: { $like: "SO-442%" }, deletedAt: null },
      { orderBy: { createdAt: "desc" } },
      input.scope,
    )
  ).find((candidate) => !["canceled", "cancelled"].includes(candidate.status ?? ""));
  const variant = await input.em.findOne(CatalogProductVariant, {
    ...input.scope,
    id: variantId,
    deletedAt: null,
  });
  const order = await input.em.findOne(SalesOrder, {
    ...input.scope,
    id: orderId,
    deletedAt: null,
  });
  if (!order442 || !variant || !order?.expectedDeliveryAt)
    throw new Error("[internal] high-priority selftest fixture is incomplete.");
  await ensureDemoProductionSlots(input.em, input.scope, variant, order.expectedDeliveryAt, order442.orderNumber, "high");
  await input.commandBus.execute("supplier_demo.supply_case.open_from_shortfall", {
    input: {
      salesOrderId: orderId,
      orderNumber,
      shortfalls: [{ catalogVariantId: variantId, requiredQuantity: 500, reservedQuantity: 300, shortfallQuantity: 200 }],
      trigger: "wms_shortfall",
    },
    ctx,
  });
  const highCase = await findOneWithDecryption(input.em, SupplyCase, { ...input.scope, salesOrderId: orderId, deletedAt: null }, undefined, input.scope);
  if (highCase?.status !== "escalated" || highCase.statusReason !== "policy_human_required" || highCase.currentCommitment.map((entry) => entry.quantity).join("/") !== "300/200")
    throw new Error(`[internal] high-priority initial plan did not escalate with 300/200: status=${highCase?.status ?? "missing"}/${highCase?.statusReason ?? "missing"}, commitments=${JSON.stringify(highCase?.currentCommitment ?? null)}.`);
  await cleanup(input.em, input.scope, orderId);
  await ensureDemoProductionSlots(input.em, input.scope, variant, order.expectedDeliveryAt, order442.orderNumber, "normal");
  await input.commandBus.execute("supplier_demo.supply_case.open_from_shortfall", {
    input: {
      salesOrderId: orderId,
      orderNumber,
      shortfalls: [{ catalogVariantId: variantId, requiredQuantity: 500, reservedQuantity: 300, shortfallQuantity: 200 }],
      trigger: "wms_shortfall",
    },
    ctx,
  });
  const normalCase = await findOneWithDecryption(input.em, SupplyCase, { ...input.scope, salesOrderId: orderId, deletedAt: null }, undefined, input.scope);
  if (normalCase?.status !== "proposal_ready" || normalCase.currentCommitment.map((entry) => entry.quantity).join("/") !== "400/100" || Number(normalCase.additionalCost ?? 0) !== 120)
    throw new Error("[internal] normal fixture was not restored after the high-priority branch.");
  await cleanup(input.em, input.scope, orderId);
}

async function runCounterEvaluation(
  input: SelftestInput,
  orderId: string,
  variantId: string,
  orderNumber: string,
): Promise<void> {
  const ctx = commandContext(input.container, input.scope);
  const order442 = await findOneWithDecryption(
    input.em,
    SalesOrder,
    { ...input.scope, orderNumber: "SO-442", deletedAt: null },
    undefined,
    input.scope,
  );
  const order = await input.em.findOne(SalesOrder, {
    ...input.scope,
    id: orderId,
    deletedAt: null,
  });
  const variant = await input.em.findOne(CatalogProductVariant, {
    ...input.scope,
    id: variantId,
    deletedAt: null,
  });
  if (!order442 || !order?.expectedDeliveryAt || !variant)
    throw new Error("[internal] counter evaluation fixture is incomplete.");
  await ensureDemoProductionSlots(
    input.em,
    input.scope,
    variant,
    order.expectedDeliveryAt,
    order442.orderNumber,
    "normal",
  );
  await input.commandBus.execute(
    "supplier_demo.supply_case.open_from_shortfall",
    {
      input: {
        salesOrderId: orderId,
        orderNumber,
        shortfalls: [
          {
            catalogVariantId: variantId,
            requiredQuantity: 500,
            reservedQuantity: 300,
            shortfallQuantity: 200,
          },
        ],
        trigger: "wms_shortfall",
      },
      ctx,
    },
  );
  const supplyCase = await findOneWithDecryption(
    input.em,
    SupplyCase,
    { ...input.scope, salesOrderId: orderId, deletedAt: null },
    undefined,
    input.scope,
  );
  if (!supplyCase)
    throw new Error("[internal] Counter evaluation case was not persisted.");
  const proposal = await findOneWithDecryption(
    input.em,
    SupplyMessage,
    {
      ...input.scope,
      supplyCaseId: supplyCase.id,
      direction: "outbound",
      messageType: "SUPPLY_PROPOSAL",
      deletedAt: null,
    },
    { orderBy: { createdAt: "desc" } },
    input.scope,
  );
  if (!proposal)
    throw new Error(
      "[internal] Counter evaluation proposal was not persisted.",
    );
  if (
    supplyCase.currentCommitment.map((entry) => entry.quantity).join("/") !== "400/100" ||
    supplyCase.policyDecision !== "auto_approved" ||
    Number(supplyCase.additionalCost ?? 0) !== 120
  )
    throw new Error(
      `[internal] initial normal-priority fixture did not preserve 400/100 +120: commitments=${JSON.stringify(supplyCase.currentCommitment)}, policy=${supplyCase.policyDecision ?? "missing"}, cost=${supplyCase.additionalCost ?? "missing"}.`,
    );
  proposal.deliveryStatus = "delivered";
  supplyCase.status = "proposal_delivered";
  await input.em.flush();
  const productionSlots = await input.em.find(
    SupplierProductionSlot,
    { ...input.scope, catalogVariantId: variantId, deletedAt: null },
    { orderBy: { startsAt: "asc" } },
  );
  const slotDates = productionSlots.map((slot) =>
    slot.startsAt.toISOString().slice(0, 10),
  );
  const firstCounterDate =
    supplyCase.currentCommitment[0]?.date ?? slotDates[0];
  const secondCounterDate = slotDates.at(-1);
  const fridayDate = slotDates.find((date) => date > (firstCounterDate ?? "") && date !== secondCounterDate) ?? slotDates[1];
  if (!firstCounterDate || !secondCounterDate || !fridayDate)
    throw new Error(
      "[internal] counter evaluation requires two distinct production dates.",
    );
  const channel = await resolveMailboxPollChannel({
    em: input.em,
    expectedScope: input.scope,
  });
  const messageId = `selftest-counter-${randomUUID()}@supplier-demo.local`;
  // D1/D2 fixture: the Manufacturer asks for the last production slot. It is feasible without moving an order,
  // while the sibling regression cases below exercise the high-priority move and shortage recommendation.
  const firstCounterQuantity = 400;
  const secondCounterQuantity = 100;
  const envelope: Extract<
    SupplyEnvelope,
    { messageType: "SUPPLY_COUNTER_PROPOSAL" }
  > = {
    schemaVersion: 1,
    messageId: `COUNTER-${randomUUID()}`,
    correlationId: supplyCase.correlationId,
    messageType: "SUPPLY_COUNTER_PROPOSAL",
    sender: supplyCase.recipientEmail ?? "manufacturer-a@example.test",
    recipient:
      proposal.senderEmail ??
      process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ??
      "supplier-demo@example.test",
    payload: {
      sku: supplyCase.sku,
      inReplyToMessageId: proposal.businessMessageId,
      requestedCommitments: [
        { quantity: firstCounterQuantity, date: firstCounterDate },
        { quantity: secondCounterQuantity, date: secondCounterDate },
      ],
    },
  };
  const ingested = await input.commandBus.execute(
    "communication_channels.message.ingest_inbound",
    {
      input: {
        channelId: channel.id,
        providerKey: "imap",
        channelType: "email",
        scope: input.scope,
        message: {
          externalMessageId: messageId,
          externalConversationId: `selftest-counter-thread-${supplyCase.id}`,
          senderIdentifier: envelope.sender,
          subject: `Re: [${supplyCase.correlationId}] Delivery update — ${supplyCase.sku}`,
          body: `Local selftest counter.\n\n${renderSupplyEnvelope(envelope)}`,
          bodyFormat: "text",
          timestamp: new Date(),
          channelPayload: {
            from: envelope.sender,
            to: envelope.recipient,
            messageId,
          },
          channelContentType: "text/plain",
          channelMetadata: { messageId },
        },
      },
      ctx,
    },
  );
  const ingestResult = executionResult(ingested);
  if (typeof ingestResult.channelLinkId !== "string")
    throw new Error("[internal] counter ingest did not return a channel link.");
  await input.commandBus.execute(
    "supplier_demo.supply_message.receive_inbound",
    {
      input: {
        channelLinkId: ingestResult.channelLinkId,
        messageId: ingestResult.messageId,
        externalMessageId: ingestResult.externalMessageId,
      },
      ctx,
    },
  );
  const counter = await findOneWithDecryption(
    input.em,
    SupplyMessage,
    {
      ...input.scope,
      supplyCaseId: supplyCase.id,
      direction: "inbound",
      messageType: "SUPPLY_COUNTER_PROPOSAL",
      validationStatus: "valid",
      deletedAt: null,
    },
    undefined,
    input.scope,
  );
  if (!counter)
    throw new Error(
      "[internal] counter was not persisted by the installed ingest path.",
    );
  await input.commandBus.execute("supplier_demo.supply_case.evaluate_counter", {
    input: { caseId: supplyCase.id, supplyMessageId: counter.id },
    ctx,
  });
  input.em.clear();
  const evaluated = await findOneWithDecryption(
    input.em,
    SupplyCase,
    { ...input.scope, id: supplyCase.id, deletedAt: null },
    undefined,
    input.scope,
  );
  const evaluatedCounter = await findOneWithDecryption(
    input.em,
    SupplyMessage,
    {
      ...input.scope,
      id: counter.id,
      supplyCaseId: supplyCase.id,
      deletedAt: null,
    },
    undefined,
    input.scope,
  );
  const record = evaluatedCounter?.negotiationRecord;
  // Explicit expected values: with the negotiation switch on, the case stays in flight for the agent, and 400/50 is
  // the requested 400/100 split is feasible without moving an allocation.
  const requestedOption = record?.evaluation?.options[0];
  if (
    !evaluated ||
    evaluated.status !== "counter_received" ||
    evaluated.statusReason !== "counter_evaluated" ||
    !record?.evaluation ||
    record.evaluation.options.length !== 1 ||
    requestedOption?.id !== "requested" ||
    !requestedOption.feasible ||
    requestedOption.policyDecision !== "auto_approved" ||
    requestedOption.movedAllocations.length !== 0 ||
    requestedOption.commitments.map((entry) => entry.quantity).join("/") !== "400/100"
  )
    throw new Error(
      `[internal] counter evaluation did not persist the expected 400/100 evaluation: status=${evaluated?.status ?? "missing"}, reason=${evaluated?.statusReason ?? "missing"}, options=${JSON.stringify(record?.evaluation?.options.map((option) => [option.id, option.commitments, option.feasible, option.policyDecision]) ?? null)}.`,
    );
  const warehouseReserved = supplyCase.baselineCommitment.find((entry) => entry.date === supplyCase.originalCommitment[0]?.date)?.quantity ?? 0;
  const evaluationCases: Array<{
    requested: SupplyCommitment[];
    expected: { feasible: boolean; policyDecision: "auto_approved" | "human_required"; moved: number; optionId: "requested" };
  }> = [
    {
      requested: [{ quantity: 400, date: firstCounterDate }, { quantity: 100, date: secondCounterDate }],
      expected: { feasible: true, policyDecision: "auto_approved", moved: 0, optionId: "requested" },
    },
    {
      requested: [{ quantity: 450, date: firstCounterDate }, { quantity: 50, date: fridayDate }],
      expected: { feasible: true, policyDecision: "human_required", moved: 1, optionId: "requested" },
    },
    {
      requested: [{ quantity: 500, date: firstCounterDate }],
      expected: { feasible: false, policyDecision: "human_required", moved: 1, optionId: "requested" },
    },
  ];
  for (const scenario of evaluationCases) {
    const scenarioEvaluation = evaluateCounter({
      requested: scenario.requested,
      current: supplyCase.currentCommitment,
      originalDate: supplyCase.originalCommitment[0]?.date ?? null,
      warehouseReserved,
      slots: productionSlots,
      caseOrderNumber: supplyCase.orderNumber,
      negotiationTurn: supplyCase.negotiationTurn,
      maxTurns: 3,
    });
    const option = scenarioEvaluation.options.find((candidate) => candidate.id === scenario.expected.optionId);
    if (!option || option.feasible !== scenario.expected.feasible || option.policyDecision !== scenario.expected.policyDecision || option.movedAllocations.length !== scenario.expected.moved)
      throw new Error(`[internal] fixture counter evaluation mismatch for ${JSON.stringify(scenario.requested)}: ${JSON.stringify(scenarioEvaluation.options)}.`);
  }
  const bestEffort = evaluateCounter({
    requested: [{ quantity: 500, date: firstCounterDate }],
    current: supplyCase.currentCommitment,
    originalDate: supplyCase.originalCommitment[0]?.date ?? null,
    warehouseReserved,
    slots: productionSlots,
    caseOrderNumber: supplyCase.orderNumber,
    negotiationTurn: supplyCase.negotiationTurn,
    maxTurns: 3,
  }).options.find((option) => option.id === "alt_best_effort");
  if (!bestEffort || bestEffort.commitments.map((entry) => `${entry.quantity}/${entry.date}`).join(",") !== `450/${firstCounterDate},50/${fridayDate}` || bestEffort.policyDecision !== "human_required")
    throw new Error("[internal] fixture counter evaluation did not produce the expected 450/50 best-effort alternative.");
  // Q7: the model input is pseudonymised; no order number, e-mail or slot id may leave the Supplier OM.
  const modelInput = JSON.stringify(buildSupplierCounterAgentInput(record));
  if (/SO-\d|@|slot-|fromSlotId|orderNumber/.test(modelInput))
    throw new Error("[internal] counter agent input leaks Supplier-private identifiers.");
  if (
    input.mode === "agent-stub" ||
    input.mode === "agent-decline" ||
    input.mode === "approve-reject" ||
    input.mode === "crash-recovery" ||
    input.mode === "reopen-recovery" ||
    input.mode === "usage-caps" ||
    input.mode === "concurrent-approve" ||
    input.mode === "send-toggle" ||
    input.mode === "proposal-send-toggle" ||
    input.mode === "auto-recovery"
  ) {
    // The real runtime resolves the model before calling the scripted provider seam, so it needs a provider key.
    // Without one, a process-local placeholder and an unreachable base URL guarantee that nothing leaves the host.
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      process.env.OPENROUTER_API_KEY = "selftest-placeholder";
      process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:9";
    }
    const config = {
      provider: "openrouter",
      model: "meta/muse-spark-1.3-contributor",
      timeoutMs: 5_000,
      maxRunsPerCase: input.mode === "usage-caps" ? 1 : 4,
      maxRunsPerDay: 50,
      maxOutputTokens: 500,
      maxNegotiationTurns: 3,
    };
    const runStub = async () => {
      const current = await findOneWithDecryption(
        input.em,
        SupplyMessage,
        { ...input.scope, id: counter.id, deletedAt: null },
        undefined,
        input.scope,
      );
      const currentRecord = current?.negotiationRecord;
      const option = currentRecord?.evaluation?.options.find(
        (candidate) => candidate.id === "requested" && candidate.feasible,
      );
      if (!option)
        throw new Error("[internal] agent selftest has no feasible option.");
      // Human-approval scenarios make the model escalate: the case then offers the deterministic fallback
      // (the requested split) to a person instead of sending it automatically.
      const escalate =
        input.mode === "concurrent-approve" ||
        input.mode === "send-toggle" ||
        input.mode === "proposal-send-toggle";
      // The scripted provider answer. It goes through the real runAiAgentObject (agent registry, policy gate,
      // prompt composition, model resolution) and replaces only the provider call via its generateObject seam,
      // so a runtime policy rejection makes this selftest fail instead of hiding behind a stubbed runtime.
      const scripted = {
        object: input.mode === "agent-decline"
          ? {
              decision: "decline",
              optionId: null,
              reasonCodes: ["stock_shortage_on_requested_date"],
              rationale: "The requested date has a stock shortage; a person should decide whether to reject it.",
              confidence: 0.7,
            }
          : escalate
          ? {
              decision: "escalate",
              optionId: null,
              reasonCodes: ["insufficient_information"],
              rationale: "Selftest escalation to a person.",
              confidence: 0.2,
            }
          : {
              decision: "accept_requested",
              optionId: option.id,
              reasonCodes: ["requested_feasible_within_policy"],
              rationale: "The requested split is feasible within policy.",
              confidence: 0.9,
            },
        usage: { inputTokens: 3, outputTokens: 2, reasoningTokens: null },
        finishReason: "stop",
      };
      return runSupplierCounterNegotiation({
        em: input.em,
        scope: input.scope,
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        container: input.container,
        config,
        runObject: async (request) =>
          (await runAiAgentObject({
            ...request,
            generateObject: async () => scripted,
          } as never)) as never,
      });
    };
    if (
      input.mode === "agent-stub" ||
      input.mode === "agent-decline" ||
      input.mode === "concurrent-approve" ||
      input.mode === "send-toggle" ||
      input.mode === "proposal-send-toggle" ||
      input.mode === "auto-recovery"
    ) {
      await runStub();
      input.em.clear();
      const after = await findOneWithDecryption(
        input.em,
        SupplyMessage,
        { ...input.scope, id: counter.id, deletedAt: null },
        undefined,
        input.scope,
      );
      const afterCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      const afterRecord = after?.negotiationRecord;
      const declined = input.mode === "agent-decline";
      const escalated =
        input.mode === "concurrent-approve" ||
        input.mode === "send-toggle" ||
        input.mode === "proposal-send-toggle";
      // Auto path: an agent recommendation that passes G1-G9 keeps the case in flight with a durable dispatch.
      // Escalation: the case needs a human, with the deterministic fallback as the approvable recommendation.
      const expected = declined
        ? afterCase?.status === "needs_human" &&
          afterCase.statusReason === "agent_recommends_decline" &&
          !afterRecord?.recommendation &&
          afterRecord?.dispatch.state === "none"
        : escalated
        ? afterCase?.status === "needs_human" &&
          afterCase.statusReason === "agent_escalated" &&
          afterRecord?.recommendation?.source === "deterministic" &&
          afterRecord.recommendation.autoEligible === false
        : afterCase?.status === "counter_received" &&
          afterRecord?.recommendation?.source === "agent" &&
          afterRecord.recommendation.autoEligible === true &&
          afterRecord.dispatch.state === "pending";
      if (
        !expected ||
        afterRecord?.agent.attempts.at(-1)?.outcome !== "ok" ||
        afterRecord.agent.attempts.at(-1)?.usage.inputTokens !== 3
      )
        throw new Error(
          `[internal] agent-stub did not persist the expected recommendation and usage: status=${afterCase?.status ?? "missing"}/${afterCase?.statusReason ?? "missing"}, source=${afterRecord?.recommendation?.source ?? "missing"}, dispatch=${afterRecord?.dispatch.state ?? "missing"}.`,
        );
      if (declined) {
        const rejection = await input.commandBus.execute("supplier_demo.supply_case.reject_counter", {
          input: { caseId: supplyCase.id, supplyMessageId: counter.id, updatedAt: afterCase?.updatedAt },
          ctx,
        });
        if (executionResult(rejection).reason !== "counter_rejected")
          throw new Error("[internal] agent-decline did not leave Reject available without a recommendation.");
      }
    }
    if (input.mode === "usage-caps") {
      const failStub = async () => {
        throw new Error("selftest provider failure");
      };
      await runSupplierCounterNegotiation({
        em: input.em,
        scope: input.scope,
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        container: input.container,
        config,
        runObject: failStub as never,
      });
      // Re-run through Reopen (the environment allows 4 attempts, so Reopen schedules a fresh attempt); the
      // runner here is capped at 1 attempt per case, so the claim must refuse before any provider call.
      input.em.clear();
      const failedCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      await input.commandBus.execute("supplier_demo.supply_case.reopen", {
        input: { caseId: supplyCase.id, updatedAt: failedCase?.updatedAt },
        ctx,
      });
      let providerCalls = 0;
      await runSupplierCounterNegotiation({
        em: input.em,
        scope: input.scope,
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        container: input.container,
        config,
        runObject: (async () => {
          providerCalls += 1;
          throw new Error("selftest provider must not be called");
        }) as never,
      });
      input.em.clear();
      const after = await findOneWithDecryption(
        input.em,
        SupplyMessage,
        { ...input.scope, id: counter.id, deletedAt: null },
        undefined,
        input.scope,
      );
      const cappedCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      const afterRecord = after?.negotiationRecord;
      if (
        !afterRecord ||
        providerCalls !== 0 ||
        afterRecord.agent.attempts.length !== 1 ||
        afterRecord.agent.skipReason !== "max_runs_per_case" ||
        cappedCase?.statusReason !== "agent_attempt_limit_reached"
      )
        throw new Error(
          `[internal] usage cap did not fence the second attempt: attempts=${afterRecord?.agent.attempts.length ?? "missing"}, skip=${afterRecord?.agent.skipReason ?? "missing"}, calls=${providerCalls}, reason=${cappedCase?.statusReason ?? "missing"}.`,
        );
    }
    if (input.mode === "crash-recovery") {
      const claimedAt = new Date();
      const claim = await claimSupplierCounterAttempt({
        em: input.em,
        scope: input.scope,
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        config,
        modelInput: { selftest: true },
        now: claimedAt,
      });
      if (claim.kind !== "claimed")
        throw new Error(
          "[internal] crash-recovery did not create a durable claim.",
        );
      const recovered = await claimSupplierCounterAttempt({
        em: input.em,
        scope: input.scope,
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        config,
        modelInput: { selftest: true },
        now: new Date(claimedAt.getTime() + config.timeoutMs + 31_000),
      });
      if (recovered.kind !== "skipped" || recovered.reason !== "agent_timeout")
        throw new Error(
          "[internal] crash-recovery did not settle the stale claim.",
        );
    }
    if (input.mode === "approve-reject") {
      const currentCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      await input.commandBus.execute(
        "supplier_demo.supply_case.reject_counter",
        {
          input: {
            caseId: supplyCase.id,
            supplyMessageId: counter.id,
            updatedAt: currentCase?.updatedAt,
          },
          ctx,
        },
      );
      const rejected = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      if (rejected?.statusReason !== "counter_rejected")
        throw new Error(
          "[internal] approve-reject did not reject the active counter.",
        );
    }
    if (input.mode === "concurrent-approve" || input.mode === "send-toggle") {
      const currentCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      if (!currentCase)
        throw new Error("[internal] approval selftest case was not reloaded.");
      const approvalInput = {
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        updatedAt: currentCase.updatedAt,
      };
      await input.commandBus.execute(
        "supplier_demo.supply_case.approve_counter",
        { input: approvalInput, ctx },
      );
      if (input.mode === "concurrent-approve") {
        let secondApprovalStatus: number | null = null;
        try {
          await input.commandBus.execute(
            "supplier_demo.supply_case.approve_counter",
            { input: approvalInput, ctx },
          );
        } catch (error) {
          const candidate = error as { status?: unknown };
          secondApprovalStatus =
            typeof candidate.status === "number" ? candidate.status : null;
        }
        const revisions = await findWithDecryption(
          input.em,
          SupplyMessage,
          {
            ...input.scope,
            supplyCaseId: supplyCase.id,
            direction: "outbound",
            messageType: "SUPPLY_PROPOSAL",
            inReplyToBusinessId: counter.businessMessageId,
            deletedAt: null,
          },
          undefined,
          input.scope,
        );
        const afterApproval = await findOneWithDecryption(
          input.em,
          SupplyCase,
          { ...input.scope, id: supplyCase.id, deletedAt: null },
          undefined,
          input.scope,
        );
        if (
          secondApprovalStatus !== 409 ||
          revisions.length !== 1 ||
          afterApproval?.negotiationTurn !== 1
        )
          throw new Error(
            `[internal] concurrent-approve did not fence the duplicate approval: status=${secondApprovalStatus ?? "missing"}, revisions=${revisions.length}, turn=${afterApproval?.negotiationTurn ?? "missing"}.`,
          );
      }
      if (input.mode === "send-toggle") {
        const toggle = await input.em.findOne(FeatureToggle, {
          identifier: supplierDemoNegotiationToggleId,
          deletedAt: null,
        });
        if (!toggle)
          throw new Error(
            "[internal] send-toggle could not resolve the negotiation feature toggle.",
          );
        let overrideActive = false;
        try {
          await input.commandBus.execute(
            "feature_toggles.overrides.changeState",
            {
              input: {
                toggleId: toggle.id,
                tenantId: input.scope.tenantId,
                isOverride: true,
                overrideValue: false,
              },
              ctx,
            },
          );
          overrideActive = true;
          const revision = await findOneWithDecryption(
            input.em,
            SupplyMessage,
            {
              ...input.scope,
              supplyCaseId: supplyCase.id,
              direction: "outbound",
              messageType: "SUPPLY_PROPOSAL",
              inReplyToBusinessId: counter.businessMessageId,
              deletedAt: null,
            },
            { orderBy: { createdAt: "desc" } },
            input.scope,
          );
          if (!revision)
            throw new Error(
              "[internal] send-toggle approval did not create a revision.",
            );
          await input.commandBus.execute("supplier_demo.supply_message.send", {
            input: { supplyMessageId: revision.id },
            ctx,
          });
          const afterSend = await findOneWithDecryption(
            input.em,
            SupplyCase,
            { ...input.scope, id: supplyCase.id, deletedAt: null },
            undefined,
            input.scope,
          );
          const counterAfterSend = await findOneWithDecryption(
            input.em,
            SupplyMessage,
            { ...input.scope, id: counter.id, deletedAt: null },
            undefined,
            input.scope,
          );
          const dispatch = counterAfterSend?.negotiationRecord?.dispatch;
          if (
            afterSend?.statusReason !== "auto_negotiation_disabled_send" ||
            revision.deliveryStatus !== "pending" ||
            dispatch?.state !== "held" ||
            dispatch.heldReason !== "auto_negotiation_disabled_send"
          )
            throw new Error(
              `[internal] send-toggle did not hold the revision: status=${afterSend?.statusReason ?? "missing"}, delivery=${revision.deliveryStatus}, dispatch=${dispatch?.state ?? "missing"}.`,
            );
        } finally {
          if (overrideActive)
            await input.commandBus.execute(
              "feature_toggles.overrides.changeState",
              {
                input: {
                  toggleId: toggle.id,
                  tenantId: input.scope.tenantId,
                  isOverride: false,
                },
                ctx,
              },
            );
        }
      }
    }
    if (input.mode === "proposal-send-toggle") {
      const currentCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      if (!currentCase)
        throw new Error("[internal] proposal-send-toggle case was not reloaded.");
      await input.commandBus.execute(
        "supplier_demo.supply_case.approve_counter",
        {
          input: {
            caseId: supplyCase.id,
            supplyMessageId: counter.id,
            updatedAt: currentCase.updatedAt,
          },
          ctx,
        },
      );
      const toggle = await input.em.findOne(FeatureToggle, {
        identifier: supplierDemoToggleId,
        deletedAt: null,
      });
      if (!toggle)
        throw new Error(
          "[internal] proposal-send-toggle could not resolve the proposal feature toggle.",
        );
      let overrideActive = false;
      try {
        await input.commandBus.execute(
          "feature_toggles.overrides.changeState",
          {
            input: {
              toggleId: toggle.id,
              tenantId: input.scope.tenantId,
              isOverride: true,
              overrideValue: false,
            },
            ctx,
          },
        );
        overrideActive = true;
        const revision = await findOneWithDecryption(
          input.em,
          SupplyMessage,
          {
            ...input.scope,
            supplyCaseId: supplyCase.id,
            direction: "outbound",
            messageType: "SUPPLY_PROPOSAL",
            inReplyToBusinessId: counter.businessMessageId,
            deletedAt: null,
          },
          { orderBy: { createdAt: "desc" } },
          input.scope,
        );
        if (!revision)
          throw new Error(
            "[internal] proposal-send-toggle approval did not create a revision.",
          );
        await input.commandBus.execute("supplier_demo.supply_message.send", {
          input: { supplyMessageId: revision.id },
          ctx,
        });
        const afterSend = await findOneWithDecryption(
          input.em,
          SupplyCase,
          { ...input.scope, id: supplyCase.id, deletedAt: null },
          undefined,
          input.scope,
        );
        const counterAfterSend = await findOneWithDecryption(
          input.em,
          SupplyMessage,
          { ...input.scope, id: counter.id, deletedAt: null },
          undefined,
          input.scope,
        );
        const dispatch = counterAfterSend?.negotiationRecord?.dispatch;
        if (
          afterSend?.statusReason !== "auto_proposal_disabled_send" ||
          revision.deliveryStatus !== "pending" ||
          dispatch?.state !== "held" ||
          dispatch.heldReason !== "auto_proposal_disabled_send"
        )
          throw new Error(
            `[internal] proposal-send-toggle did not hold the revision: status=${afterSend?.statusReason ?? "missing"}, delivery=${revision.deliveryStatus}, dispatch=${dispatch?.state ?? "missing"}.`,
          );
      } finally {
        if (overrideActive)
          await input.commandBus.execute(
            "feature_toggles.overrides.changeState",
            {
              input: {
                toggleId: toggle.id,
                tenantId: input.scope.tenantId,
                isOverride: false,
              },
              ctx,
            },
          );
      }
    }
    if (input.mode === "auto-recovery") {
      const afterAgent = await findOneWithDecryption(
        input.em,
        SupplyMessage,
        { ...input.scope, id: counter.id, deletedAt: null },
        undefined,
        input.scope,
      );
      if (!afterAgent?.negotiationRecord?.recommendation?.autoEligible)
        throw new Error(
          "[internal] auto-recovery fixture did not produce an auto-eligible recommendation.",
        );
      const proposalToggle = await input.em.findOne(FeatureToggle, {
        identifier: supplierDemoToggleId,
        deletedAt: null,
      });
      if (!proposalToggle)
        throw new Error(
          "[internal] auto-recovery could not resolve the proposal feature toggle.",
        );
      let overrideActive = false;
      try {
        await input.commandBus.execute(
          "feature_toggles.overrides.changeState",
          {
            input: {
              toggleId: proposalToggle.id,
              tenantId: input.scope.tenantId,
              isOverride: true,
              overrideValue: false,
            },
            ctx,
          },
        );
        overrideActive = true;
        const recovery = await input.commandBus.execute(
          "supplier_demo.supply_case.recover_counter_processing",
          {
            input: {
              caseId: supplyCase.id,
              supplyMessageId: counter.id,
              lostEventAfterMs: 0,
            },
            ctx,
          },
        );
        if (executionResult(recovery).recovered !== 1)
          throw new Error(
            `[internal] auto-recovery did not re-emit the pending recommendation: recovered=${executionResult(recovery).recovered ?? "missing"}.`,
          );
        await input.commandBus.execute(
          "supplier_demo.supply_case.approve_counter",
          {
            input: {
              caseId: supplyCase.id,
              supplyMessageId: counter.id,
              source: "auto",
            },
            ctx,
          },
        );
        const replay = await input.commandBus.execute(
          "supplier_demo.supply_case.recover_counter_processing",
          {
            input: {
              caseId: supplyCase.id,
              supplyMessageId: counter.id,
              lostEventAfterMs: 0,
            },
            ctx,
          },
        );
        if (executionResult(replay).recovered !== 0)
          throw new Error(
            `[internal] auto-recovery replay was not idempotent: recovered=${executionResult(replay).recovered ?? "missing"}.`,
          );
        const revisions = await findWithDecryption(
          input.em,
          SupplyMessage,
          {
            ...input.scope,
            supplyCaseId: supplyCase.id,
            direction: "outbound",
            messageType: "SUPPLY_PROPOSAL",
            inReplyToBusinessId: counter.businessMessageId,
            deletedAt: null,
          },
          undefined,
          input.scope,
        );
        const finalCounter = await findOneWithDecryption(
          input.em,
          SupplyMessage,
          { ...input.scope, id: counter.id, deletedAt: null },
          undefined,
          input.scope,
        );
        const finalRecord = finalCounter?.negotiationRecord;
        if (
          revisions.length !== 1 ||
          finalRecord?.verdict?.kind !== "auto_approved" ||
          finalRecord.dispatch.source !== "auto" ||
          finalRecord.dispatch.state !== "revision_pending"
        )
          throw new Error(
            `[internal] auto-recovery did not persist one auto-approved pending revision: revisions=${revisions.length}, verdict=${finalRecord?.verdict?.kind ?? "missing"}, dispatch=${finalRecord?.dispatch.state ?? "missing"}.`,
          );
      } finally {
        if (overrideActive)
          await input.commandBus.execute(
            "feature_toggles.overrides.changeState",
            {
              input: {
                toggleId: proposalToggle.id,
                tenantId: input.scope.tenantId,
                isOverride: false,
              },
              ctx,
            },
          );
      }
    }
    if (input.mode === "reopen-recovery") {
      const failStub = async () => {
        throw new Error("selftest provider failure");
      };
      await runSupplierCounterNegotiation({
        em: input.em,
        scope: input.scope,
        caseId: supplyCase.id,
        supplyMessageId: counter.id,
        container: input.container,
        config,
        runObject: failStub as never,
      });
      const currentCase = await findOneWithDecryption(
        input.em,
        SupplyCase,
        { ...input.scope, id: supplyCase.id, deletedAt: null },
        undefined,
        input.scope,
      );
      await input.commandBus.execute("supplier_demo.supply_case.reopen", {
        input: { caseId: supplyCase.id, updatedAt: currentCase?.updatedAt },
        ctx,
      });
      const reopened = await findOneWithDecryption(
        input.em,
        SupplyMessage,
        { ...input.scope, id: counter.id, deletedAt: null },
        undefined,
        input.scope,
      );
      const reopenedRecord = reopened?.negotiationRecord;
      if (
        !reopenedRecord?.evaluation ||
        reopenedRecord.agent.attempts.length !== 1 ||
        reopenedRecord.agent.state === "succeeded"
      )
        throw new Error(
          "[internal] reopen-recovery did not retain history and reset the fresh evaluation.",
        );
    }
  }
}

export async function runSupplierRealPathSelftest(
  input: SelftestInput,
): Promise<void> {
  const { order, variant } = await fixture(input.em, input.scope);
  try {
    if (input.mode === "loop-real")
      await runLoopReal(input, order.id, variant.id);
    else if (input.mode === "level3-fallback")
      await runLevel3Fallback(input, order.id, variant.id, order.orderNumber);
    else if (input.mode === "initial-high-priority")
      await runHighPriorityInitialPlan(input, order.id, variant.id, order.orderNumber);
    else
      await runCounterEvaluation(
        input,
        order.id,
        variant.id,
        order.orderNumber,
      );
  } finally {
    await cleanup(input.em, input.scope, order.id);
  }
}
