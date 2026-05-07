# 0052 — Disjoint removed-set semantics in sprint membership

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** architect, developer
**Proposal:** [0050-removed-set-semantics-in-planning-accuracy](../proposals/0050-removed-set-semantics-in-planning-accuracy.md)

## Context

`SprintMembershipService` (introduced in ADR 0049) returned a single
`removedKeys: Set<string>` that conflated two structurally distinct kinds of
removal:

1. **Committed-then-removed** — issues present at sprint start that left the
   sprint mid-flight.
2. **Added-then-removed** — issues that joined after start and were then
   removed before sprint end (mid-sprint churn).

`PlanningService` consumed `removedKeys.size` directly in two formulas:

- `scopeChange% = (added + removed) / commitment * 100`
- `completionRate = completed / (commitment + added − removed) * 100`

Because `added` already counts added-then-removed issues and `removed`
included them again, `scopeChangePercent` **double-counted** mid-sprint
churn. The `completionRate` divisor was simultaneously deflated by the same
issues, producing inflated completion rates on noisy sprints. A separate
symptom — `SprintDetailService` and `PlanningService` reporting different
`commitment` numbers for the same sprint — was rooted in the same single-set
ambiguity: each call site was free to pick its own interpretation.

## Options Considered

### Option A — Keep `removedKeys`, add a derived `addedRemovedCount` field
- **Summary:** Leave the union set in place; expose a sibling counter so
  consumers can subtract themselves.
- **Pros:** Smallest diff; no consumer migration required.
- **Cons:** Does not fix the existing bug — every current consumer of
  `removedKeys.size` would still be wrong by default. Any new consumer is one
  line away from re-introducing the same double-count.

### Option B — Split the set, ship a deprecated `removedKeys` alias for one release
- **Summary:** Add `committedRemovedKeys` / `addedRemovedKeys`; keep
  `removedKeys = committedRemovedKeys ∪ addedRemovedKeys` as a deprecated
  alias for one release.
- **Pros:** Backwards-compatible during migration.
- **Cons:** `SprintMembership` is an internal-only TypeScript type with no
  external consumers. The alias preserves the ambiguity it was created to
  remove and invites the next reader to re-enter the bug. There is no
  deprecation window worth honouring.

### Option C — Split the set; clean break; counts-only API helper *(chosen)*
- **Summary:** Replace `removedKeys` with two disjoint sets
  `committedRemovedKeys` and `addedRemovedKeys` in the same commit, migrate
  every consumer at once, and add a pure helper `summariseMembership()` that
  returns the canonical counts. The HTTP API surface keeps the existing field
  names (`commitment`, `added`, `removed`) — only the numeric meaning of
  `removed` is corrected.
- **Pros:** Eliminates the double-count at its source; gives planning and
  sprint-detail a single source of truth; keeps the public API surface
  minimal; encodes the formulas in one place so consumers cannot drift.
- **Cons:** All in-repo consumers must migrate together; the `removed`
  field's numeric meaning changes for callers that compared against
  historical screenshots.

## Decision

**Adopt Option C.** Split `SprintMembership.removedKeys` into two disjoint
sets:

```typescript
interface SprintMembership {
  committedKeys: Set<string>;          // present at sprint start
  addedKeys: Set<string>;              // joined after sprint start (gross)
  currentMemberKeys: Set<string>;      // in sprint at sprint end
  committedRemovedKeys: Set<string>;   // committedKeys ∖ currentMemberKeys
  addedRemovedKeys: Set<string>;       // addedKeys     ∖ currentMemberKeys
}
```

Add a pure helper `summariseMembership(m)` exported from
`backend/src/sprint-membership/sprint-membership.service.ts` as the **only**
sanctioned source of these counts:

| Quantity | Formula |
|---|---|
| `commitment` | `committedKeys.size` |
| `added` | `addedKeys.size` (gross — includes added-then-removed) |
| `removed` | `committedRemovedKeys.size` (committed-removed only) |
| `scopeChangePercent` | `(addedKeys.size + committedRemovedKeys.size) / commitment * 100`, rounded to 2 dp; `0` when `commitment === 0` |
| `completionRate` | `completed / currentMemberKeys.size * 100`; `0` when divisor is `0` |

`removedKeys` is removed in the same commit. `PlanningService`,
`SprintDetailService`, `SupportService`, and all spec mocks migrate together
(implementation commit `4a847e4`; RED tests asserting disjointness and
no add-then-remove double-count in commit `dc9823f`).

## Rationale

The previous shape baked an ambiguity into the type itself, leaving every
caller to choose an interpretation. Splitting the set at the source moves
the correctness boundary into `SprintMembershipService` and removes the
ability for new consumers to introduce the same bug. A counts-only helper
keeps the API DTO unchanged — the frontend never needed the disjoint key
sets — while guaranteeing planning and sprint-detail render identical
commitment numbers. A clean break is safe here because `SprintMembership` is
an internal type with no external consumers and the alias would re-introduce
the very ambiguity the split exists to remove.

## Consequences

- **Positive:**
  - `scopeChangePercent` is no longer inflated by mid-sprint add-then-remove
    churn; `completionRate`'s divisor (`currentMemberKeys.size`) is the
    mathematically correct final-set size.
  - `PlanningService` and `SprintDetailService` now read commitment, added,
    and removed counts through the same helper and can no longer disagree.
  - The canonical formulas live in one place; future consumers of
    `SprintMembership` cannot reimplement them and drift.
- **Negative / trade-offs:**
  - Every in-repo consumer of `SprintMembership` had to migrate in a single
    commit (`4a847e4`); no transitional alias.
  - The `removed` field on the planning API response keeps its name but its
    numeric meaning is corrected — a behavioural change. Acceptable because
    this is an internal-only dashboard with no external API consumers; the
    new value is the one users have always intended to read.
- **Risks:**
  - A consumer that bypasses `summariseMembership()` and reads
    `committedRemovedKeys` / `addedRemovedKeys` directly could reintroduce a
    drift between pages. Mitigated by leaving the helper as the only
    sanctioned entry point and by the property test asserting
    `committedRemovedKeys ∩ addedRemovedKeys = ∅`.

## Related Decisions

- [ADR 0049](0049-sprint-membership-service.md) — established
  `SprintMembershipService` and the four-set membership shape this ADR
  refines.
- [ADR 0050](0050-third-audit-bug-fix-batch.md) — prior audit-batch ADR in
  the same series; sets the pattern of correcting planning-accuracy
  semantics in small, traceable steps.
- [ADR 0051](0051-cfr-denominator-deployment-events.md) — companion
  decision in this audit series, unifying CFR and DF denominator units.
  ADR 0052 applies the same principle (single source of truth for a count)
  to sprint membership.
- [Proposal 0050](../proposals/0050-removed-set-semantics-in-planning-accuracy.md)
  — driving proposal; contains the worked examples, alternatives, and
  acceptance criteria.
