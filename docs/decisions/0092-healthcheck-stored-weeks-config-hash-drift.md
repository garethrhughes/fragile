# 0092 — Atomic changelog replacement; Healthcheck weeks persisted, config-hashed, drift explicit

**Date:** 2026-09-14
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0086-healthcheck-reproducibility-stored-weeks.md
**Amends:** 0070 (live-computed, no persistence)

## Context

The same closed week — `2026-W35` — was reported at 26.67% on 7–8 Sep and 30.43% on 14 Sep, both
with the default `includeSupport=true`. `30.43% = 7/23`, and 26.67% requires a denominator of 15,
30, 45, 60 or 75, so the **denominator** differed, not only the numerator. The denominator is

```
first_start(t) = min over t.changelog of transitions into inProgressStatusNames
denominator(W) = { t : board(t) is a scrum board, first_start(t) ∈ window(W) }
```

`first_start` is a minimum over an append-only history, so a closed week's denominator must be
immutable unless board membership or the predicate config changed. Answering "which happened?"
required pulling full changelogs from the Jira API for all 362 candidate issues on the five scrum
boards and recomputing from scratch, because the system retained nothing to diff.

That reconstruction put the true denominator at **23** — matching 14 Sep and reproducing the whole
38-row ticket array (23 scrum + 15 PLAT). It eliminated: Jira-side truncation (0 of 362 short
fetches; the API returns oldest-first, so a short read drops the *newest* entries and cannot move a
minimum later); the `sprint is not EMPTY` sync predicate (all 23 had a non-empty sprint field on
7 Sep); `inProgressStatusNames` drift (the denominator is 23 under every config from
`['In Progress']` to the full 23-entry list); every additive leak (Epic/Sub-task filter bypassed
→ 28, PLAT mis-typed as scrum → 35, both → 41, all-boards kanban-entry → 38, none of which display
as 26.7%); and a whole board dropping out (contributions are ACC 6, BPT 5, DATA 5, OCS 1, SPS 6 —
no subset sums to the 8 that would need to be lost).

So the 7–8 Sep run was short by **8 tickets spread across boards** — a per-ticket loss. The only
mechanism that produces that is an incomplete stored changelog, and the code contained one:

```ts
const entries = this.mapChangelogEntries(issueKey, response.values);
if (entries.length > 0) {
  if (startAt === 0) await this.changelogRepo.delete({ issueKey });  // destructive
  await this.changelogRepo.save(entries);
}
startAt += response.maxResults;
```

Between the `delete` and the `save` the issue has zero changelog rows, and the daily full sync does
this for every issue on every board. Worse, a later page throwing (Jira 429 past the retry budget,
a network blip) propagates to `syncBoard`'s catch and leaves the issue **permanently** truncated or
empty until some later sync touches it again; `syncChangelogsBulk` runs `Promise.all` over batches
of 5, so an aborting run can leave several issues mid-replace. And `startAt += response.maxResults`
never advances if `maxResults` is 0.

Compounding it, the consumer was silent: for a scrum board `firstStartDate` returns `null` when no
in-progress transition is found, and the ticket is then simply absent from the denominator — no
error, no warning, no "excluded for missing data" count. An incomplete mirror was
indistinguishable from work that never started.

**This diagnosis is not proven.** Confirming that a sync aborted in that window needs `sync_logs`
and `jira_changelogs` from production, a private RDS instance (correctly) unreachable from a
developer machine. It is the only surviving hypothesis and the defect is demonstrable in code, but
the causal link to those two specific runs is inferred, not observed.

## Options Considered

### Option A — Fix the sync, leave the report live-computed
- **Pros:** Addresses the mechanism.
- **Cons:** The next time two runs disagree the investigation starts from zero again. The
  underlying problem is that nothing is retained to diff.

### Option B — Persist every (week, includeSupport) combination
- **Cons:** Legitimises two competing canonical figures for the same week.

### Option C — Fix the sync, persist the canonical week, make drift explicit (chosen)
Atomic changelog replacement, plus one stored row per ISO week with a config hash pinning the
predicate identity, plus a `first_start` monotonicity assertion that catches precisely this class
of corruption.
- **Pros:** Fixes the mechanism and makes any recurrence self-evident instead of requiring an
  external reconstruction.
- **Cons:** New table; the first read of a cold week pays the compute cost.

## Decision

1. **`syncIssueChangelog` is atomic.** Every page is fetched **before** the database is touched,
   then the delete and insert run inside a **single transaction**. Nothing is written unless the
   whole changelog was retrieved, so a mid-fetch failure leaves the previous copy intact and no
   reader can observe a partially-rebuilt history. An empty Jira response still does not wipe
   stored rows, and a non-advancing page cursor terminates instead of looping.

2. **Missing history is reported, not swallowed.** `HealthcheckService` warns when an issue sits in
   a status it can only have reached by transitioning (in-progress or done) yet has zero stored
   status changelog rows. Deliberately a `warn`, not an exception: an issue created directly into
   an in-progress status fires no Jira status event and lands in the same bucket.

3. **`healthcheck_snapshots`** — one row per ISO week (PK `week`) holding the **canonical**
   (`includeSupport=true`) figure: the full response payload (numerator, denominator, ticket key
   list, trend), a `configHash`, the derived `first_start` per ticket, and `computedAt`.

4. **Write-through on first read of a completed week.** No new cron and no change to the sync path.
   The **current** week is never stored — it is legitimately still moving. A `view=live` request
   never establishes the baseline: letting a drift probe enshrine the value being investigated
   would defeat the purpose.

5. **`includeSupport=false` is always live** and never reads or writes a snapshot. It changes both
   the denominator and the numerators (ADR 0091), so it is an exploratory re-slice, not the
   canonical figure. The response echoes the flag so the two views are never confused.

6. **`configHash`** — SHA-256 over the sorted, per-board tuple of `boardType`,
   `inProgressStatusNames`, `boardEntryStatuses`, `doneStatusNames`, `cancelledStatusNames`, plus
   the contributing board set. Order-insensitive so a cosmetic reorder is not drift. **Not**
   case-normalised: the denominator predicate is case-sensitive, so a casing change is a real
   semantic change and must change the hash.

7. **`view=stored|live`**, default `stored`. The response gains `source`, `computedAt`,
   `configHash`, and the echoed `includeSupport`.

8. **Drift is reported, never auto-corrected.** `view=live` on a week with a stored row returns a
   `drift` object: per-dimension stored-vs-live counts, `configHashChanged`, tickets that joined or
   left the week, and `firstStartRegressions`. The stored row is left untouched — overwriting it
   would destroy the evidence that a discrepancy existed.

9. **`first_start` monotonicity is asserted.** A minimum over an append-only history can never
   increase, so a ticket whose derived `first_start` moves **later** than the stored value is a
   defect — and specifically the signature of a truncated stored changelog, i.e. exactly the fault
   above. Logged at `error` and returned in `drift.firstStartRegressions`. Every run logs the
   derived `first_start` per ticket at `debug`, and each ticket carries `firstStart` in the
   response.

10. **`firstStartDate` is computed as a true minimum.** It previously used `logs.find()`, which
    depended on the caller supplying the changelog in ascending `changedAt` order via an `ORDER BY`
    in `healthcheck.service.ts`. Behaviour-preserving under the current caller; it removes a
    latent class of the same bug. Not the cause of this incident.

## Consequences

- **Scoring semantics are unchanged.** No change to what Stability, Roadmap or Support mean, to the
  denominator definition, or to the bands. `Blocked` and `READY` remain in-progress statuses (a
  deliberate design choice).
- **No historical data is rewritten.** The first stored row for a week is whatever the current data
  yields; earlier disagreeing figures are not reconstructed.
- **Existing damage is not repaired.** The atomic replace stops new corruption; issues already left
  short stay short until re-synced. Size it first with
  `backend/src/scripts/check-changelog-completeness.ts`.
- Changelog sync now holds a transaction per issue and buffers one issue's changelog in memory.
  Bounded and small (tens to low thousands of rows), and concurrency is already capped at 5.
- Completed weeks are served from one indexed row instead of a full per-board issue + changelog
  scan — the report gets faster as a side effect.
- Reading a week for the first time performs a write. Acceptable: the endpoint is internal-only
  (ADR 0020) and the write is a single row keyed by week.
- Unversioned board config is made **observable** via `configHash`, not fixed. An `updatedAt`
  column plus an audit row, and a decision on whether YAML or the database is authoritative at
  boot, remain open — `YamlConfigService` still re-seeds `board_configs` from the image-baked
  `config/boards.yaml` on every application boot.
- The scrum sync JQL `project = X AND sprint is not EMPTY` means a scrum issue worked outside a
  sprint is invisible until it is added to one, at which point it retroactively joins its
  historical week. 895 of 4,089 issues on the five scrum boards currently match `sprint is EMPTY`.
  Not causal here, but a live path by which a closed week's denominator can grow; deferred to its
  own proposal and now detectable via the stored figure.
