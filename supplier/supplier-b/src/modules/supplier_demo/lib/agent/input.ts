import { createHash } from "node:crypto";
import type { SupplierNegotiationRecord } from "../negotiation-record";

type EvaluationOption = NonNullable<
  SupplierNegotiationRecord["evaluation"]
>["options"][number];

// Only pseudonymised, numeric Supplier facts leave the OM (owner decision Q7): other customers' order numbers,
// slot ids and execution fingerprints stay local. Allocations are referenced as allocation#n, numbered in a
// stable order across all options of one evaluation.
export type SupplierCounterAgentOption = {
  optionId: EvaluationOption["id"];
  commitments: EvaluationOption["commitments"];
  feasible: boolean;
  policyDecision: EvaluationOption["policyDecision"];
  maxShiftHours: number;
  incrementalCost: number;
  slaProtected: boolean;
  highPriorityAllocationMoved: boolean;
  deviationFromRequested: number;
  movedAllocations: Array<{
    ref: string;
    quantity: number;
    fromDate: string;
    toDate: string;
    shiftHours: number;
  }>;
};

export type SupplierCounterAgentInput = {
  evaluationId: string;
  turn: number;
  maxTurns: number;
  rule: SupplierNegotiationRecord["counterRule"];
  // Numbers only: what was ordered, what we proposed, what the buyer asks for, and the shortage behind it.
  supply: NonNullable<SupplierNegotiationRecord["evaluation"]>["context"] | null;
  options: SupplierCounterAgentOption[];
};

export function buildSupplierCounterAgentInput(
  record: SupplierNegotiationRecord,
): SupplierCounterAgentInput {
  if (!record.evaluation)
    throw new Error(
      "[internal] Supplier counter agent input requires an evaluation.",
    );
  const references = new Map<string, string>();
  const referenceFor = (orderNumber: string | undefined) => {
    const key = orderNumber ?? "";
    if (!references.has(key))
      references.set(key, `allocation#${references.size + 1}`);
    return references.get(key) as string;
  };
  return {
    evaluationId: record.evaluation.id,
    turn: record.evaluation.turnAtEvaluation,
    maxTurns: record.evaluation.maxTurns,
    rule: record.counterRule,
    supply: record.evaluation.context ?? null,
    options: record.evaluation.options.map((option) => ({
      optionId: option.id,
      commitments: option.commitments.map((commitment) => ({ ...commitment })),
      feasible: option.feasible,
      policyDecision: option.policyDecision,
      maxShiftHours: option.maxShiftHours,
      incrementalCost: option.incrementalCost,
      slaProtected: option.slaProtected,
      highPriorityAllocationMoved: option.highPriorityAllocationMoved,
      deviationFromRequested: option.distance,
      movedAllocations: option.movedAllocations.map((move) => ({
        ref: referenceFor(move.orderNumber),
        quantity: move.quantity,
        fromDate: move.fromDate,
        toDate: move.toDate,
        shiftHours: move.shiftHours,
      })),
    })),
  };
}

export function serializeSupplierCounterAgentInput(
  input: SupplierCounterAgentInput,
): string {
  return JSON.stringify(
    { task: "select_existing_option", facts: input },
    null,
    2,
  );
}

export function hashSupplierText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
