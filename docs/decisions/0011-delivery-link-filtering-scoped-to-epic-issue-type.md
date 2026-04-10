# 0011 — Delivery Link Filtering Scoped to Epic Issue Type Only

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Decision Log Agent, implementation reviewed
**Proposal:** N/A

## Context

`SyncService.syncJpdProject()` iterates over the `issuelinks` on each JPD idea to find
delivery links — links of the "Polaris work item" / "is implemented by" type that
connect a JPD idea to its delivery work. Previously the sync recorded the key of any
linked issue on a matching link type, regardless of that issue's type. The risk is that
non-Epic issues (Stories, Bugs, Sub-tasks) could be stored in `deliveryIssueKeys`.
Because roadmap accuracy is calculated by checking whether `issue.epicKey` appears in
the `coveredEpicKeys` set (built from `jpd_ideas.deliveryIssueKeys`), non-Epic keys
silently inflate `deliveryIssueKeys` without contributing to any coverage match and
distort the signal.

## Options Considered

### Option A — Filter delivery links to Epic issue type at sync time
- **Summary:** After identifying a delivery link by type name, only record the linked
  issue's key if `inwardIssue.fields.issuetype.name === 'Epic'` (or `outwardIssue`
  respectively); discard all other issue types silently
- **Pros:**
  - Keeps `deliveryIssueKeys` semantically correct — contains only Epic keys that can
    actually produce coverage matches
  - Prevents silent inflation of `deliveryIssueKeys` with unmatchable keys
  - Simple predicate; no schema change required
- **Cons:**
  - If a tenant legitimately links a Story directly to a JPD idea as a delivery item,
    that link is silently dropped; the operator must add an intermediate Epic

### Option B — Store all linked keys; filter to Epics at query time
- **Summary:** Store all delivery-linked keys in `deliveryIssueKeys` regardless of type;
  then at accuracy query time, cross-reference only against known Epic keys
- **Pros:**
  - Preserves the raw link data; useful if query logic changes
- **Cons:**
  - `deliveryIssueKeys` grows with unmatchable entries on every sync
  - Adds a join or lookup step at query time to identify which stored keys are Epics
  - The coverage set (`coveredEpicKeys`) is already built by matching against
    `issue.epicKey`; non-Epic keys in `deliveryIssueKeys` are always inert, so
    storing them provides no benefit

### Option C — Make the accepted issue type configurable per RoadmapConfig
- **Summary:** Add an `allowedDeliveryIssueTypes` array to `RoadmapConfig`; default
  to `['Epic']`
- **Pros:**
  - Handles tenants that use a non-standard hierarchy where Stories are delivered against
    JPD ideas directly
- **Cons:**
  - Adds schema and API surface for an edge case that has not been observed in practice
  - Coverage matching still only works via `issue.epicKey`; allowing Stories would
    require a separate matching path

## Decision

> We will filter delivery links at sync time: only record a linked issue's key in
> `deliveryIssueKeys` when `inwardIssue.fields.issuetype.name === 'Epic'` (or
> `outwardIssue`, as applicable). All other issue types are discarded.

## Rationale

The roadmap accuracy calculation is built on the invariant that `deliveryIssueKeys`
contains Epic keys, because sprint issues are matched via `issue.epicKey`. Storing
non-Epic keys in `deliveryIssueKeys` cannot produce coverage matches and would only
inflate the array with noise. Filtering at sync time (Option A) is simpler and cheaper
than filtering or joining at query time (Option B), and avoids the need to introduce
configuration overhead (Option C) for an edge case not present in the current data.
If a future tenant requires Story-level delivery links, that use case should drive a
separate coverage-matching path, not a relaxation of this filter.

## Consequences

- **Positive:**
  - `deliveryIssueKeys` is a clean list of Epic keys; coverage set construction is
    straightforward and efficient
  - Roadmap coverage percentages are not silently distorted by unmatchable keys
- **Negative / trade-offs:**
  - JPD ideas linked to Stories or Bugs (rather than Epics) will show zero coverage
    in the accuracy report; operators must use Epic-level delivery links
- **Risks:**
  - If Jira returns the issue type under a localised or non-standard name (e.g. `"Épique"`
    in a French-locale tenant), the filter will silently drop valid links; the hardcoded
    string `'Epic'` may need to be relaxed to a case-insensitive check or moved to config

## Related Decisions

- [ADR-0009](0009-roadmap-accuracy-jpd-sync-strategy.md) — Decision 2 (delivery link
  type matching) and Decision 5 (`deliveryIssueKeys` as `simple-array`) provide the
  context in which this filter operates
- [ADR-0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — Pattern of
  per-board configurable rule strings; Option C above mirrors this pattern and is
  deferred to a future ADR if the need arises
