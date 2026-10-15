# Manufacturing Module — Agent Guidelines

Layering ADR: `.ai/specs/2026-10-15-manufacturing-wms-integration-profile.md`.

## Always

- Keep production logic in `domain/` (pure) and `application/` (use cases); keep `api/`, `backend/`, `commands/`, `data/`, `subscribers/` thin.
- Talk to other modules only through a port in `ports/` implemented by an adapter in `adapters/<module>/`, bound in `di.ts`.
- Post stock changes through `ProductionInventoryService` (`application/`), never the gateway directly; one movement per execution document, `operationId` as the idempotency reference.

## Never

- Never import another module, or use its command ids, outside `adapters/` — `__tests__/architecture.test.ts` fails the build.
- Never import `adapters/` from anywhere but `di.ts`.
- Never keep a parallel stock ledger; WMS owns stock and decides.

## Validation Commands

```bash
yarn workspace @open-mercato/core test src/modules/manufacturing
```
