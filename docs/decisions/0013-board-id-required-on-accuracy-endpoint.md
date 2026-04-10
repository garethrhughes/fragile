# 0013 — `boardId` Made Required on the Roadmap Accuracy Endpoint

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Decision Log Agent, implementation reviewed
**Proposal:** N/A

## Context

`RoadmapAccuracyQueryDto` declared `boardId` as an optional field, and the controller
defaulted to the string `'ACC'` when the parameter was omitted:

```typescript
const boardId = query.boardId ?? 'ACC';
```

The `'ACC'` default was valid only in the original developer's local Jira environment.
On any other tenant — or with any board whose key is not `ACC` — omitting `boardId`
would silently route the request to a non-existent or wrong board, returning either
empty data or data for the wrong team with no indication that the parameter was missing.
The implicit default also means the API contract exposed via OpenAPI/Swagger does not
communicate that `boardId` is practically mandatory.

## Options Considered

### Option A — Mark `boardId` as required; remove the fallback default
- **Summary:** Add `@IsNotEmpty()` and `@ApiProperty()` (non-optional) to `boardId` in
  `RoadmapAccuracyQueryDto`; remove the `?? 'ACC'` expression in the controller
- **Pros:**
  - API contract is explicit: callers know `boardId` is required from the OpenAPI spec
  - Requests without `boardId` receive HTTP 400 with a validation error rather than
    silently returning wrong or empty data
  - Removes environment-specific coupling from the codebase
- **Cons:**
  - Any existing clients that relied on the `'ACC'` default will break; this is a
    breaking change for those callers (considered acceptable given the default was
    never a correct general behaviour)

### Option B — Keep `boardId` optional but choose a more neutral default (e.g. `null`)
- **Summary:** Replace `'ACC'` with `null`; have the service return all boards or an
  explanatory error when no `boardId` is given
- **Pros:**
  - Non-breaking for callers that omit `boardId`
- **Cons:**
  - "Return accuracy for all boards" is not a supported use case and adds complexity
  - A null default still masks the missing parameter rather than surfacing it

### Option C — Keep `boardId` optional; log a warning when the default is used
- **Summary:** Keep `?? 'ACC'` but emit a warning log when the fallback is triggered
- **Pros:**
  - Non-breaking
- **Cons:**
  - The environment-specific default `'ACC'` remains in the codebase
  - The API contract remains misleading; warnings are not visible to API consumers

## Decision

> We will mark `boardId` with `@IsNotEmpty()` and `@ApiProperty()` as a non-optional
> parameter in `RoadmapAccuracyQueryDto`, and remove the `?? 'ACC'` fallback from the
> controller.

## Rationale

An optional parameter with an environment-specific hardcoded default is a latent bug:
it works only in one context, silently produces wrong results in all others, and hides
the missing parameter from callers. Making `boardId` required (Option A) is the correct
API design — the endpoint is meaningless without a board context. The breaking change
risk is negligible because the `'ACC'` default was never a valid general behaviour;
any caller relying on it was already receiving incorrect data outside the original
developer's environment.

## Consequences

- **Positive:**
  - The OpenAPI spec correctly communicates that `boardId` is required
  - Missing `boardId` results in a descriptive HTTP 400 validation error rather than
    silent misrouting
  - The codebase has no environment-specific magic strings in controller logic
- **Negative / trade-offs:**
  - Callers that previously omitted `boardId` will receive HTTP 400 instead of a
    (silently incorrect) response; they must be updated to supply an explicit `boardId`
- **Risks:**
  - If an automated integration test was written against the `'ACC'` default without
    supplying `boardId`, it will begin failing after this change; test coverage should
    be verified

## Related Decisions

- [ADR-0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — `BoardConfig`
  is the per-board configuration store; `boardId` is the key used to look up config,
  reinforcing that every accuracy request must be board-scoped
- [ADR-0009](0009-roadmap-accuracy-jpd-sync-strategy.md) — Establishes the accuracy
  endpoint and its query parameters; this ADR tightens the contract for `boardId`
