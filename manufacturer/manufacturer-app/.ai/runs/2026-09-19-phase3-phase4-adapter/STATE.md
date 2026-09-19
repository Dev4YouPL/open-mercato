# Phase 3/Phase 4 adapter run state

**Status:** BLOCKED
**Date:** 2026-09-19
**Scope:** adapter contract and `COVERAGE_SHORTFALL` only

## Entry gate

The Phase 1/2 closure artifacts now exist, but their verdict is still `IN_PROGRESS` for both
phases. The exit gates are not met: live provider evidence and real RFQ/delivery evidence remain
missing. The browser matrix, `REJECT`/`EDIT` coverage, and the Phase 2 mechanism decision are now
closed locally. Because the requested closure state does not confirm the exit gates, adapter
implementation remains stopped. No adapter, enum, locale, read-model, UI, or Phase 4 source file
has been changed by this run.

## Resolved decisions awaiting unblocking

- `stock.allocated` is the absolute quantity consumed by the plan and maps to
  `internalStockAllocation`.
- Supplier 1 and Supplier 2 roles remain explicit in the output; no missing commitment is
  fabricated.
- `COMMIT` maps to `intent: COMMIT` and `CANCEL` maps to `intent: CANCEL`.
- Unknown/damaged input returns `unreadable_plan`; internally contradictory input returns
  `invalid_plan`.
- `planHash` remains bound to the exact plan snapshot; the adapter performs no domain mutation.
- `COVERAGE_SHORTFALL` is an additive enum value. It is used only when required confirmations are
  complete and valid but coverage remains below the required quantity. Existing enum values remain
  valid, and this case must not use `ANALYSIS_FAILED`.

## Next action

Complete B-1/B-2/B-3 in the authoritative Phase 1/2 closure state, verify both exit gates, then
resume the implementation plan and run the required adapter contract tests and validation
commands. Do not mark Phase 3 or Phase 4 complete.
