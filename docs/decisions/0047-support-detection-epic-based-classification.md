# 0047 — Support Detection: Epic-Based Classification

**Date:** 2026-05-06
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0045-support-detection-epic-matching.md

## Context

Support detection in the Support Ticket Report (ADR 0045) classifies issues via two signals:
label match (`supportLabels`) and issue-link match (`supportLinkType` + `triageBoardKey`).
Teams that organise support work under dedicated Jira epics rather than labels or links cannot
use either signal accurately. The `JiraIssue` entity already stores `epicKey`; no additional
sync work is required to leverage it.

## Options Considered

### Option A — Epic key list on `BoardConfig` with OR semantics
- **Summary:** Add `supportEpics: string[]` to `BoardConfig`; classify if `epicMatch OR labelMatch OR linkMatch`; express combined matches as a composite `matchReason` string (e.g. `'epic+label'`).
- **Pros:** Reuses existing `epicKey` column; no extra Jira API calls; OR semantics preserve all existing classifications; composite string is simple and fully enumerable.
- **Cons:** Seven-value union may need extending if a fourth signal is added in future.

### Option B — Separate `epicMatch` boolean sidecar on the response
- **Summary:** Keep `matchReason: 'label' | 'link' | 'both'` and add a parallel `epicMatch: boolean` field.
- **Pros:** Non-breaking API change.
- **Cons:** Inconsistent contract; two parallel schemes for the same concept; consumers must read two fields.

### Option C — Store `matchReason` as `string[]`
- **Summary:** Replace the string union with an array of reason tokens.
- **Pros:** Extensible without a new union value.
- **Cons:** Requires schema change to Swagger, frontend types, and badge rendering; more complex than necessary for three fixed signals.

## Decision

> We will add `supportEpics: string[]` to `BoardConfig` and classify tickets using OR semantics across epic, label, and link signals, expressing combined matches as a joined composite string (`'epic'`, `'label+link'`, `'epic+label+link'`, etc.) replacing the previous `'both'` value.

## Rationale

Option A reuses the already-populated `JiraIssue.epicKey` column with no additional sync cost.
The composite string approach (`reasons.join('+')`) is the simplest representation that covers
all seven non-empty subsets of three signals without changing the field type or introducing a
parallel field. The `'both'` → `'label+link'` rename is a breaking change but is handled
atomically in the same PR since frontend and backend share the repository.

## Consequences

- **Positive:** Teams using epic-based support organisation can now use the Support Report accurately; existing label and link configurations are unchanged.
- **Negative / trade-offs:** `'both'` is retired — any external consumer of the API that matches the string `'both'` will need to be updated to `'label+link'`.
- **Risks:** If a fourth classification signal is added, the composite string pattern scales to 15 subsets (2⁴−1); still enumerable but longer. An array type would be more appropriate at that point.

## Related Decisions

- [ADR 0045](0045-support-ticket-report.md) — original support ticket report decision (introduced label and link signals)
- [ADR 0046](0046-support-sprint-membership-population.md) — sprint-mode population for the support report
