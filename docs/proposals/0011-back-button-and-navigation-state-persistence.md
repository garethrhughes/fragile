# 0011 — Back Button and Navigation State Persistence

**Date:** 2026-04-12
**Status:** Accepted
**Author:** Architect Agent
**Related ADRs:** To be created upon acceptance

---

## Problem Statement

When a user navigates from a list page (Planning, Roadmap, Cycle Time, or DORA) into a
detail page — for example by clicking a sprint name link in the Planning table — and then
returns via either the browser back button or the explicit "← Back" link rendered on the
detail page, the list page re-mounts from scratch and resets all filter selections to their
hard-coded defaults.

Concretely, a user who had selected board `BPT`, switched to `sprint` mode, and drilled
into a sprint detail will land back on the Planning page showing board `ACC` (the first
item in `ALL_BOARDS`) and period mode `sprint` — not the selections they left. The same
regression occurs on Roadmap (board + period type + kanban-period toggle), Cycle Time
(board + selected quarter + issue type filter), and DORA (board multi-selection +
period type toggle).

The root cause is that every list page holds its filter selections exclusively in
component-local `useState` hooks. There is no URL representation of these selections and no
persistent storage. When the component unmounts (on navigation away) the React state is
discarded. Re-mounting the component after a back navigation starts again from the initial
values coded into each `useState(...)` call.

---

## Goals and Non-Goals

### In Scope

- Pressing the browser back button from any detail page (`/sprint/…`, `/quarter/…`,
  `/week/…`) restores the originating list page to the exact board, period type, and
  sub-period (Kanban week/quarter, Scrum sprint/quarter) that was active when the user
  drilled in.
- Clicking the explicit "← Back" / "← Planning" / "← Roadmap" link on a detail page
  produces the same restoration.
- The DORA page board multi-selection and period-type toggle are preserved across back
  navigation.
- The Cycle Time page board, selected quarter, and issue-type filter are preserved.
- The restoration is invisible to the user — no loading flash of the wrong board before
  the correct one appears.

### Out of Scope

- Persisting state across full page reloads (F5 / Ctrl+R). The chosen approach will
  incidentally provide this for free for list pages if `sessionStorage` is used, but it
  is not a stated requirement and must not compromise the primary goal.
- Persisting state across tabs or browser sessions (`localStorage`).
- Sharing filter state between pages (e.g. changing board on DORA does not affect the
  board on Planning). Each page manages its own independent selection set.
- Preserving scroll position within a list page's data table.
- Cycle Time's dynamically-populated issue-type filter (derived from loaded data): the
  filter token is preserved, but if the data has not yet loaded there is no flash of the
  wrong chip — the chip simply re-selects once data arrives.

---

## Current State Analysis

### State management

There are two Zustand stores:

- `useFilterStore` (`frontend/src/store/filter-store.ts`): holds `selectedBoards`,
  `periodType`, `selectedSprint`, and `selectedQuarter`. **Used only by the DORA page.**
  Planning, Roadmap, and Cycle Time do not use this store.
- `useSyncStore` (`frontend/src/store/sync-store.ts`): holds sync status. Unrelated to
  this proposal.

**Planning page** (`frontend/src/app/planning/page.tsx`): all filter state is in local
`useState` — `selectedBoard` (default: `'ACC'`), `periodType` (default: `'sprint'`),
`kanbanPeriod` (default: `'week'`). No store, no URL params.

**Roadmap page** (`frontend/src/app/roadmap/page.tsx`): same pattern — `selectedBoard`
(default: `'ACC'`), `periodType` (default: `'sprint'`), `kanbanPeriod` (default: `'week'`).
No store, no URL params.

**Cycle Time page** (`frontend/src/app/cycle-time/page.tsx`): `selectedBoard` (default:
`ALL_BOARDS[0] ?? 'ACC'`), `selectedQuarter` (default: `''`, auto-set to first loaded
quarter), `issueTypeFilter` (default: `''`). No store, no URL params.

**DORA page** (`frontend/src/app/dora/page.tsx`): uniquely, this page **reads from**
`useFilterStore` for `selectedBoards` and `periodType`. These values survive as long as
the module singleton is alive (i.e. within a single tab session). Back navigation to DORA
already works better than the other pages, but only incidentally — if the Zustand module
is garbage-collected (unlikely in Next.js App Router in-tab navigation but not guaranteed)
the state is still lost.

### Existing URL param usage

Only the detail pages use `useSearchParams`. Each detail page reads a `from` query
parameter (e.g. `?from=planning`) that the list pages embed in their drill-down hrefs.
This param is used solely to label and route the "← Back" link. It is a one-way hint
from list page → detail page; the list page never reads back any URL params from its own
URL.

No list page currently reads or writes any URL search params.

### Detail page "back" link construction

All three detail page types (`sprint`, `quarter`, `week`) implement `getBackHref(from)`
and `getBackLabel(from)` helpers that translate the `?from=planning` / `?from=roadmap`
param into a static href (e.g. `/planning`, `/roadmap`). These are plain `<Link>` anchors
— they do not use `router.back()`. This means they are full navigations to the list page
URL without any selection parameters, so the list page always resets to its defaults.

---

## Options Assessment

### Option A — URL search params as source of truth

Store all filter selections in the URL:
`/planning?board=BPT&mode=sprint` or `/cycle-time?board=ACC&quarter=2026-Q1&type=Story`.
The Zustand stores are either dropped or become derived read-through caches. Back/forward
restore state because Next.js App Router preserves the full URL in browser history.
"Back" links become either `router.back()` or a constructed href containing the params.

**Pros:**
- Browser history / back button works natively — no custom code.
- URLs are bookmarkable and shareable (useful even in a single-user tool).
- No synchronisation problem between URL and store.
- Works correctly with Next.js App Router `<Link>` prefetching.

**Cons:**
- Every filter interaction must call `router.replace(url-with-new-params)`. In Next.js
  App Router this triggers a re-render of the page segment, which can cause a data
  re-fetch if `useEffect` dependencies include the derived filter values from the URL.
  The existing pages use `useEffect` with direct state variables as deps; switching to
  URL-derived values is straightforward but requires care to avoid double-fetches.
- The DORA page has a multi-value board selection (array). Encoding
  `?boards=ACC,BPT,SPS` is standard but adds a small encoding/decoding step.
- `useSearchParams()` in Next.js App Router requires the component to be wrapped in
  `<Suspense>` when used in a `'use client'` page that is statically generated — all
  pages here are already `'use client'` and dynamically rendered, so this is a non-issue.
- The "back" links on detail pages need to change from `<Link href="/planning">` to
  either `router.back()` or `<Link href="/planning?board=BPT&mode=sprint">`. Using
  `router.back()` is simpler and more robust — it restores the exact URL the user left.
- State is visible in the URL, which is desirable. No user-facing downside for this tool.

**Assessment for this codebase:** The list pages use raw `fetch` + `useEffect` (no SWR
or React Query). The data-fetching `useEffect` in each page already depends on local
state variables. If those local variables are replaced with values derived from
`useSearchParams()`, the same effect pattern continues to work correctly — a URL change
updates the derived values, which triggers the effect, which re-fetches. The coupling is
clean. This approach requires no new dependencies.

---

### Option B — Zustand persist middleware (sessionStorage)

Add the Zustand `persist` middleware to each page's relevant store slice (or create a
per-page store), persisting to `sessionStorage` keyed by page name.

**Pros:**
- Zustand `persist` is already a dependency (Zustand is installed) — no new library.
- Component code changes are minimal: replace `useState` with `useStore`.

**Cons:**
- Currently, Planning, Roadmap, and Cycle Time do **not** use Zustand stores — their
  state is fully local. Migrating each page to a dedicated Zustand store adds
  architectural ceremony (three new store files, or a single over-wide store) for a
  problem that URL params solve more directly.
- `sessionStorage` is synchronous and can cause hydration mismatches in React Server
  Components if the store is initialised on the server (not applicable here — all
  affected pages are `'use client'`) but the pattern still requires careful handling of
  the initial server render snapshot.
- The browser back button pops the URL stack but does **not** re-run the page
  component's `useEffect` if the component is still mounted in memory (Next.js App Router
  client-side navigation keeps segments alive). If the component unmounts and remounts on
  back navigation (which it does when navigating to a different route segment), the store
  value is read from `sessionStorage` on remount — this works. But it is one additional
  indirection versus the URL being the direct source of truth.
- Persisted Zustand state can go stale if the user's stored board ID is later removed
  from `ALL_BOARDS` — a minor edge case but one the URL approach handles automatically
  (the URL simply contains the current state; invalid params are trivially defaulted).
- `sessionStorage` does not survive browser back to the page from a different tab or
  from bookmark open in a new context — minor but inconsistent with user expectations.

**Assessment:** This approach requires migrating three pages from `useState` to Zustand
stores, adding three new store modules (or one composite one), plumbing `persist`
middleware, and handling hydration. The complexity-to-benefit ratio is worse than
Option A for this specific codebase, where all filter state is small and discrete.

---

### Option C — History state via `router.push` with state payload

Inject a state object into `window.history.state` via `history.pushState` or
`history.replaceState` on each filter change. Read it back on mount.

**Assessment:** Next.js App Router manages its own history state and clobbers
`history.state` entries that it doesn't recognise on internal navigations. Injecting
custom state via `history.replaceState` conflicts with the router's internal bookkeeping
and is explicitly unsupported in the App Router documentation. This option is **not
viable** for Next.js 15/16 App Router.

---

### Option D — Hybrid: URL params for shareable state, sessionStorage for ephemeral UI state

Use URL params for the primary filter selections (board, mode) and `sessionStorage` for
ephemeral UI state (e.g. sort column direction in the data table).

**Assessment:** Adds implementation complexity for no meaningful benefit given the narrow
scope of this proposal. The problem to solve is filter state persistence on back
navigation, which Option A handles completely. Ephemeral UI state (sort direction) is not
in scope. If sort state persistence is needed it can be addressed separately.

---

## Chosen Approach: Option A — URL Search Params as Source of Truth

**Justification:**

The codebase confirms that no list page currently uses URL search params, that all
data-fetching is done via raw `fetch` + `useEffect` (no library with its own caching
layer), and that there are zero existing URL-param conventions to preserve or migrate.
The cost of adoption is therefore low: replace `useState` initialisers with
`useSearchParams()` reads, and replace `setState` calls with `router.replace()` calls that
write updated params. The back button then works natively — the URL is already in browser
history. The "back" links on detail pages are changed from static `<Link href="/planning">`
to `router.back()` (one line per detail page), which perfectly restores the exact URL the
user navigated away from, including all params.

URL params are also the only approach that is naturally correct for both the browser back
button **and** the explicit back link, without any additional synchronisation. The URL is
the shared source of truth; both navigation paths read from the same history entry.

No new libraries are required. No backend changes are required. No database migration is
required.

---

## Detailed Design

### 1. URL Parameter Schema

Each page defines its own independent URL parameter set. Parameters are optional; missing
parameters default to the values listed below. All params use `router.replace` (not
`router.push`) when the user changes a filter so that filter changes do not add entries to
browser history — only full-page navigations (list → detail) do.

#### `/planning`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `board` | string | `'ACC'` | Single board ID (e.g. `BPT`) |
| `mode` | `'sprint'` \| `'quarter'` | `'sprint'` | Scrum period granularity |
| `kanban` | `'week'` \| `'quarter'` | `'week'` | Kanban period granularity (only relevant when `board` is a Kanban board) |

Example: `/planning?board=BPT&mode=quarter`
Example: `/planning?board=PLAT&kanban=quarter`

#### `/roadmap`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `board` | string | `'ACC'` | Single board ID |
| `mode` | `'sprint'` \| `'quarter'` | `'sprint'` | Scrum period granularity |
| `kanban` | `'week'` \| `'quarter'` | `'week'` | Kanban period granularity |

Example: `/roadmap?board=ACC&mode=sprint`

#### `/cycle-time`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `board` | string | `ALL_BOARDS[0]` | Single board ID |
| `quarter` | string | `''` → auto first | Quarter key e.g. `2026-Q1`; empty = auto-select first from API |
| `type` | string | `''` | Issue type filter; empty = all |

Example: `/cycle-time?board=SPS&quarter=2026-Q1&type=Story`

#### `/dora`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `boards` | string | all boards joined | Comma-separated board IDs e.g. `ACC,BPT,SPS` |
| `mode` | `'quarter'` \| `'sprint'` | `'quarter'` | Period granularity |

Example: `/dora?boards=ACC,BPT&mode=quarter`

> **Note on DORA:** The DORA page currently reads `selectedBoards` and `periodType` from
> `useFilterStore`. After this change the Zustand store values are no longer needed for
> back-navigation purposes; the URL is sufficient. However, the DORA page can be migrated
> to URL params without removing the Zustand store — the store can be left in place for
> any future cross-page sharing use case. The data-fetch `useEffect` deps simply change
> from store-derived variables to URL-derived variables.

---

### 2. New Utility Hook: `usePageParams`

Introduce a thin custom hook in `frontend/src/hooks/use-page-params.ts` that wraps
`useSearchParams()` and `useRouter()` and provides typed, page-specific accessors and
setters. This avoids duplicating the param-read/write boilerplate in every page component.

```typescript
// frontend/src/hooks/use-page-params.ts
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

/** Merge new params into the current URL without adding a history entry. */
export function useReplaceParams() {
  const router = useRouter()
  const searchParams = useSearchParams()

  return useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      }
      router.replace(`?${next.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )
}
```

Each page calls `useSearchParams()` directly to read its initial values, and calls
`useReplaceParams()` to write changes. This keeps per-page param keys explicit and
traceable; no magic abstraction over which keys each page owns.

---

### 3. Per-Page Changes

#### 3a. Planning page (`frontend/src/app/planning/page.tsx`)

**Remove:**
```typescript
const [selectedBoard, setSelectedBoard] = useState<string>('ACC');
const [periodType, setPeriodType] = useState<'sprint' | 'quarter'>('sprint');
const [kanbanPeriod, setKanbanPeriod] = useState<'quarter' | 'week'>('week');
```

**Replace with:**
```typescript
const searchParams = useSearchParams()
const replaceParams = useReplaceParams()

const selectedBoard = searchParams.get('board') ?? 'ACC'
const periodType = (searchParams.get('mode') ?? 'sprint') as 'sprint' | 'quarter'
const kanbanPeriod = (searchParams.get('kanban') ?? 'week') as 'quarter' | 'week'
```

Filter change handlers become:
```typescript
const handleSelectBoard = useCallback((boardId: string) => {
  replaceParams({ board: boardId })
  // Clear transient data state only — no longer need to clear via setState
}, [replaceParams])

// Period type toggle:
replaceParams({ mode: type })

// Kanban period toggle:
replaceParams({ kanban: period })
```

`useEffect` dependencies referencing `selectedBoard`, `periodType`, and `kanbanPeriod`
continue to work identically — they are still plain string values, just derived from the
URL instead of `useState`.

Local UI state that does **not** need to survive navigation (loading, error, rawData,
kanbanData, kanbanWeekData) remains in `useState` as today.

#### 3b. Roadmap page (`frontend/src/app/roadmap/page.tsx`)

Identical pattern to 3a: replace the three `useState` filter declarations with
`useSearchParams()` reads and `replaceParams()` writes.

`handleSelectBoard` additionally contains a `setPeriodType('quarter')` call for Kanban
boards. This becomes `replaceParams({ board: boardId, mode: KANBAN_BOARDS.has(boardId) ? 'quarter' : undefined })` — or
more readably, a conditional `replaceParams` that resets the `mode` param when switching
to a Kanban board.

#### 3c. Cycle Time page (`frontend/src/app/cycle-time/page.tsx`)

```typescript
const selectedBoard = searchParams.get('board') ?? (ALL_BOARDS[0] ?? 'ACC')
const selectedQuarter = searchParams.get('quarter') ?? ''
const issueTypeFilter = searchParams.get('type') ?? ''
```

The auto-select-first-quarter logic currently runs in the quarter-loading `useEffect`:

```typescript
if (res.length > 0 && !selectedQuarter) {
  setSelectedQuarter(res[0].quarter)
}
```

With URL params this becomes:

```typescript
if (res.length > 0 && !searchParams.get('quarter')) {
  replaceParams({ quarter: res[0].quarter })
}
```

This writes the default quarter into the URL on first load, which means subsequent back
navigation will restore the correct quarter selection.

#### 3d. DORA page (`frontend/src/app/dora/page.tsx`)

The DORA page currently reads `selectedBoards` and `periodType` from `useFilterStore`.

**Option:** Migrate completely to URL params, keeping the store in place but no longer
using it as the source of truth for these fields.

```typescript
const searchParams = useSearchParams()
const replaceParams = useReplaceParams()

const boardsParam = searchParams.get('boards')
const selectedBoards: string[] = boardsParam
  ? boardsParam.split(',').filter(Boolean)
  : ALL_BOARDS
const periodType = (searchParams.get('mode') ?? 'quarter') as 'sprint' | 'quarter'
```

`setSelectedBoards` and `setPeriodType` from the store are no longer called; instead all
mutations go through `replaceParams`. The `useFilterStore` import can be removed from
`dora/page.tsx`. The store itself is kept in `frontend/src/store/filter-store.ts` as-is
since it may be used by other code or tests (the store tests cover `useFilterStore` and
must not be broken).

**Store interaction note:** If the store's `selectedBoards` is used elsewhere (grep shows
it is only used in `dora/page.tsx`), it can be left unused without deletion. The
`stores.test.ts` file tests the store in isolation and remains valid.

---

### 4. Updating the "← Back" Links on Detail Pages

All three detail page types currently implement:

```typescript
const backHref = getBackHref(from)     // e.g. '/planning' or '/roadmap'
// ...
<Link href={backHref}>...</Link>
```

**Change:** replace the static `<Link href={backHref}>` with a `router.back()` call:

```typescript
import { useRouter } from 'next/navigation'
// ...
const router = useRouter()
// ...
<button type="button" onClick={() => router.back()} className="...">
  {backLabel}
</button>
```

`router.back()` pops one entry off the browser history stack, which is exactly the URL
the user navigated from — including all search params. This works identically for both
the explicit back link and is consistent with the browser back button.

The `getBackHref` / `getBackLabel` helpers can be simplified: `getBackLabel` is still
needed to derive the visible label text (e.g. "← Planning" vs "← Roadmap") from the
`from` param, but `getBackHref` is no longer needed and can be deleted from all three
detail page files.

**Edge case — direct URL navigation (no `from` param):** If a user opens a detail page
URL directly (e.g. from a bookmark or shared link), `router.back()` would navigate to
wherever the browser was before (could be outside the app). To handle this gracefully,
check if there is a history entry to go back to:

```typescript
function BackButton({ from }: { from: string | null }) {
  const router = useRouter()
  const label = getBackLabel(from)

  // If navigated directly (no history), fall back to the static list page href
  const fallbackHref = from === 'roadmap' ? '/roadmap' : '/planning'

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back()
        } else {
          router.push(fallbackHref)
        }
      }}
      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  )
}
```

This `BackButton` component can be defined inline in each detail page or extracted to a
shared component at `frontend/src/components/ui/back-button.tsx`.

---

### 5. Detail Page Drill-Down Links (No Change Required)

The list pages already embed `?from=planning` / `?from=roadmap` in the hrefs they pass
to drill-down links:

```typescript
href={`/sprint/${encodeURIComponent(selectedBoard)}/${encodeURIComponent(row.sprintId)}?from=planning`}
```

No change is needed here. The `from` param continues to flow from the list page into the
detail page URL, and the detail page continues to read it to determine which label to show
on the back button.

---

### 6. No-Flash Initialisation

With URL params, the initial render of the page component reads `searchParams.get('board')
?? 'ACC'`. If the user arrived via back navigation with `?board=BPT` in the URL, the
initial render already shows `BPT` — no flash of `ACC`. This is the core benefit of
Option A over Option B: there is no intermediate render of the default value before the
persisted value is read from storage.

---

### 7. No Data Migration

There are no database, API, or type changes. This is a purely frontend change. Existing
URLs without search params continue to work: every `?? 'default'` fallback handles
missing params. The change is additive and backwards-compatible.

---

## Affected Files

### New files

| File | Purpose |
|---|---|
| `frontend/src/hooks/use-page-params.ts` | `useReplaceParams()` hook — shared param-write utility |
| `frontend/src/components/ui/back-button.tsx` | `BackButton` component — replaces `<Link href={backHref}>` in detail pages with `router.back()` and a direct-link fallback |

### Modified files

| File | Change summary |
|---|---|
| `frontend/src/app/planning/page.tsx` | Replace `useState` for `selectedBoard`, `periodType`, `kanbanPeriod` with `useSearchParams` reads and `useReplaceParams` writes |
| `frontend/src/app/roadmap/page.tsx` | Same as planning page |
| `frontend/src/app/cycle-time/page.tsx` | Replace `useState` for `selectedBoard`, `selectedQuarter`, `issueTypeFilter`; update auto-quarter-select logic to write to URL |
| `frontend/src/app/dora/page.tsx` | Replace `useFilterStore` reads for `selectedBoards`/`periodType` with `useSearchParams`; write filter changes via `useReplaceParams`; remove store import |
| `frontend/src/app/sprint/[boardId]/[sprintId]/page.tsx` | Replace `<Link href={backHref}>` with `<BackButton from={from} />` or inline `router.back()`; delete `getBackHref` helper |
| `frontend/src/app/quarter/[boardId]/[quarter]/page.tsx` | Same as sprint detail page |
| `frontend/src/app/week/[boardId]/[week]/page.tsx` | Same as sprint detail page |

### Unchanged files

| File | Reason |
|---|---|
| `frontend/src/store/filter-store.ts` | Store is kept as-is; DORA page's dependency is migrated away but the module is not deleted (other tests reference it; store may be needed in future) |
| `frontend/src/store/stores.test.ts` | Tests the store in isolation; unaffected |
| `frontend/src/store/sync-store.ts` | Unrelated to navigation state |
| `frontend/src/components/layout/sidebar.tsx` | Nav links are plain hrefs to `/dora`, `/planning`, etc. — intentionally clear all filter state when the user clicks a top-level nav item (new page context) |
| All backend files | No backend changes required |

---

## Sidebar Navigation — Intentional Reset

The sidebar nav links (`/dora`, `/planning`, etc.) are plain `<Link href="/dora">` anchors
with no search params. Clicking a sidebar link therefore navigates to the page with no
params, which defaults to the initial view. This is **correct and intentional** — when a
user deliberately clicks a top-level nav item, they expect to start fresh on that page, not
be returned to a prior filter state. The persistence applies only to back-navigation, not
to deliberate top-level nav clicks.

---

## Alternatives Considered

### Alternative B — Zustand persist middleware (sessionStorage)

Zustand's built-in `persist` middleware would require migrating Planning, Roadmap, and
Cycle Time from local `useState` to dedicated Zustand stores (they currently do not use
Zustand for filter state). This adds three new store files, SSR hydration handling, and an
additional indirection between the user's filter state and the URL. The back-button
behaviour is also less reliable: sessionStorage is read after initial render, potentially
causing a visible flash of default values before the persisted value is applied.
URL params avoid this by making the correct value available synchronously on the initial
render.

### Alternative C — `history.state` injection

Next.js App Router manages `history.state` internally. Direct `history.pushState` /
`history.replaceState` calls conflict with the router's internal bookkeeping (it reads
`window.history.state` to track navigation intent). This approach is explicitly not
supported and would break Next.js navigation in unpredictable ways.

### Alternative D — Hybrid URL + sessionStorage

Provides no benefit over pure URL params for the specific set of state values involved.
All relevant filter state (board IDs, mode strings, quarter keys) is small, non-sensitive,
and entirely appropriate for URL representation.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | None | Pure frontend change |
| API contract | None | No new endpoints; no changed request shapes |
| Frontend | Component changes on 7 files; 2 new files | Filter state moves from `useState` to URL; back links move to `router.back()` |
| Tests | New unit tests for `useReplaceParams`; updated integration/E2E tests for navigation | Existing `stores.test.ts` is unchanged |
| Jira API | None | No new calls |
| Performance | Negligible | `router.replace()` on filter change is equivalent cost to `setState` triggering a re-render |
| Back/forward UX | Improved | All list pages restore exact filter state on back navigation |

---

## Open Questions

1. **`useFilterStore` removal from DORA page** — should the `useFilterStore`
   `selectedBoards` / `periodType` fields be retained as a secondary read for any
   cross-page use case, or is the DORA page the only consumer? (Current grep confirms
   it is the only consumer of `selectedBoards`; `periodType` is also only used in the
   DORA page. Safe to stop reading from the store in `dora/page.tsx` without deleting
   the store itself.)

2. **`BackButton` extraction vs inline** — should the back-button logic be a shared
   `frontend/src/components/ui/back-button.tsx` component (DRY across sprint, quarter,
   week detail pages) or left inline in each detail page? Given that all three pages
   already duplicate `getBackHref` / `getBackLabel`, extraction is cleaner but slightly
   increases component surface area. Recommend extraction.

3. **`window.history.length` direct-link fallback** — `window.history.length > 1` is a
   heuristic. A user who opens a detail URL directly in a tab that has had other
   navigations (e.g. was redirected from `localhost:3000/` to `/dora`) will have
   `history.length > 1` but no prior list-page entry. In that case `router.back()` will
   go to whatever was before. The `fallbackHref` handles the case where `history.length
   === 1`. Is this acceptable, or should we require `from` to be present and non-null as
   the guard condition instead? (Using `from !== null` as the guard is simpler and more
   semantically correct — it means "I know where I came from, so back() is safe.")

---

## Acceptance Criteria

- [ ] Navigating from `/planning?board=BPT&mode=sprint` to a sprint detail page and
      pressing the browser back button returns the user to
      `/planning?board=BPT&mode=sprint` with `BPT` selected and sprint mode active. No
      flash of `ACC` or quarter mode.

- [ ] Clicking the "← Planning" back link on a sprint detail page produces the same
      restoration as the browser back button.

- [ ] Clicking the "← Back to Roadmap" link on a quarter detail page navigates back to
      `/roadmap` with the board and period type that was active when the user drilled in.

- [ ] Clicking the "← Planning" link on a week detail page navigates back to
      `/planning` with the Kanban board and week/quarter toggle that was active.

- [ ] Changing the board on the Planning page writes `?board=<id>` to the URL via
      `router.replace`. The URL updates without adding a history entry.

- [ ] Changing the period type toggle on the DORA page writes `?mode=<value>` to the
      URL via `router.replace`. A subsequent back navigation restores the previous mode.

- [ ] The Cycle Time page restores `board`, `quarter`, and `type` params on back
      navigation. If `quarter` was auto-selected (no prior param), the auto-selected
      value is written into the URL on first load so subsequent back navigation restores it.

- [ ] The sidebar nav links (`/dora`, `/planning`, `/roadmap`, `/cycle-time`) navigate
      to the page with no search params, resetting to defaults. This is intentional and
      must not be changed.

- [ ] Direct navigation to a detail page URL (no `from` param) renders the back button
      with a sensible fallback label and does not throw a JavaScript error when clicked.

- [ ] `useReplaceParams` hook merges new params into existing params (does not discard
      unrelated params set by other controls). Verified by unit test.

- [ ] `useReplaceParams` deletes a param when `null` or `''` is passed as the value.
      Verified by unit test.

- [ ] Existing `stores.test.ts` passes without modification.

- [ ] No regressions in existing navigation flows: clicking a board chip, toggling
      period mode, and drilling into a detail page all function correctly with URL-param
      state.
