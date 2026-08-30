# Manufacturing routing drafts specification

## Goal

Publish the reviewed Manufacturing P1.5 routing specification set and its aligned roadmap/documentation updates as one coherent documentation PR.

## Scope

- Add the P1.5a routing family/initial draft, P1.5b operation authoring, and P1.5c reordering specifications.
- Add the shared `CrudForm.mutationResource` prerequisite specification and retain the superseded discovery analysis as historical context.
- Align the Manufacturing roadmap, readiness backlog, Work Centre dependencies, spec indexes, and public documentation with the split delivery plan.

## Non-goals

- No product-code implementation, database migration, generated artifact, or runtime contract change.
- No implementation of Manufacturing P1.0a, P1.5, P1.6, or the shared CrudForm prerequisite.

## Implementation Plan

### Phase 1: Publish reviewed specification set

1. Commit the execution plan so the documentation run is resumable.
2. Commit the reviewed specifications and all directly related roadmap/documentation alignment.

### Phase 2: Verify and publish

1. Run docs-relevant validation and manually review the complete diff for consistency and scope.
2. Open and finalize a pull request against `develop` in `Dev4YouPL/open-mercato`, including labels and review evidence.

## Risks

- Adjacent roadmap documents can drift from the three-way P1.5 split; the final diff review must check every touched reference.
- The specifications reserve additive future contract names, so reviewers should confirm naming and prerequisite boundaries before implementation begins.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Publish reviewed specification set

- [ ] 1.1 Commit the execution plan
- [ ] 1.2 Commit the reviewed specifications and documentation alignment

### Phase 2: Verify and publish

- [ ] 2.1 Run docs-relevant validation and review the complete diff
- [ ] 2.2 Open and finalize the pull request
