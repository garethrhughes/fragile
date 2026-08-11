# Healthcheck Report — How It Is Constructed

_Documentation for Confluence. Describes the weekly, org-wide engineering Healthcheck
report: what it measures, how each score is calculated, how boards are combined, and how
the data flows from Jira through to the dashboard._

---

## 1. What the Healthcheck Report Is

The Healthcheck report is a **weekly, org-wide engineering-health summary**. For a selected
ISO week it produces **three pooled percentage scores** — **Stability**, **Roadmap**, and
**Support** — each measured against **one shared denominator**: the tickets that _started
work_ in that week. It also shows a **trailing 8-week trend** and a **per-ticket breakdown
table**.

It replaced the older "Pulse" report. Key characteristics:

- **Live-computed on every request** — there is no stored snapshot; the numbers are always
  derived fresh from the data mirror.
- **Reads only from the internal Jira mirror** (a Postgres copy of Jira data) — it never
  calls Jira live.
- **URL-driven** — the selected week is a query parameter (`?week=YYYY-Www`); by default it
  shows the **last completed ISO week**.
- **Org-wide only** — the three scores combine all relevant boards into a single figure each;
  there is no per-board breakdown in the scores (only in the ticket table).

---

## 2. The Shared Denominator — "Tickets Started This Week"

Every score is a fraction of the **same base set** `D`, so the three percentages are directly
comparable.

`D` is the set of the org's tickets whose **first-ever start of work** fell inside the
selected week `[weekStart, weekEnd]`, where:

- **Epics and sub-tasks are excluded** from every calculation (they are containers, not work
  items).
- **Scrum boards:** "start of work" = the first time the ticket transitioned into an
  **In Progress** status (the exact status names are configurable per board; default
  `In Progress`).
- **Kanban boards:** "start of work" = the first transition **onto the board** (configurable
  board-entry statuses). If a kanban ticket has no such transition (e.g. it was created
  directly on the board), its **creation date** is used instead.

Only the **first-ever** start transition counts — a ticket that was reopened and started
again in a later week is attributed to the week it _first_ started.

The size of this set, `|D|`, is the denominator for all three scores that week.

---

## 3. The Three Scores

Each score is a simple percentage of the tickets started that week:

```
score = 100 × (matching tickets) ÷ (tickets started)
```

The result is rounded to 2 decimal places. If **no tickets started** that week (`|D| = 0`)
or the dimension does not apply to any contributing board, the score is **N/A** (shown as a
neutral empty state, and as a gap on the trend chart).

| Score         | Applies to    | Counts tickets that…                                             | Direction      |
| ------------- | ------------- | ---------------------------------------------------------------- | -------------- |
| **Stability** | Scrum only    | were **planned** (committed to / carried over into the sprint)   | Higher = better |
| **Roadmap**   | Scrum only    | are **linked to a roadmap idea** (via epic or direct link)       | Higher = better |
| **Support**   | All boards    | are **reactive support work** (support epic, label, or triage link) | **Lower = better** |

### 3.1 Stability

Of the tickets that started this week, the share that were **planned work**.

A ticket is "planned" if, at the moment it moved to In Progress, it was **committed to** — or
**carried over into** — the sprint that was active at that time. Sprint membership is
reconstructed from the ticket's history (Jira does not expose a historical snapshot directly),
and carry-over from the immediately prior sprint is counted as committed.

If a ticket started outside any sprint window, it is treated as **not planned**.

Higher is better: it means most work being started was planned rather than injected mid-sprint.

- **Formula:** `100 × (planned tickets started) ÷ (tickets started)`
- **Kanban:** does not apply — kanban boards contribute nothing to Stability.

### 3.2 Roadmap

Of the tickets that started this week, the share **linked to a roadmap idea**.

The link can be either via the ticket's **epic** (preferred) or a **direct issue link** of an
allowlisted type. This is a **membership check only** — it asks whether the work maps to the
roadmap, **not** whether it has been delivered. Cancelled tickets do not count as linked.

Higher is better: it means most work being started traces back to the roadmap.

- **Formula:** `100 × (roadmap-linked tickets started) ÷ (tickets started)`
- **Kanban:** does not apply — kanban boards contribute nothing to Roadmap.

### 3.3 Support

Of the tickets that started this week, the share that are **reactive support work**.

A ticket counts as support if **any** of these signals match (configurable per board):

- it belongs to a designated **support epic**, or
- it carries a designated **support label**, or
- it has a **link to the triage board** of an allowlisted link type.

**Lower is better** — a high figure means a large proportion of started work was unplanned
support rather than planned delivery.

- **Formula:** `100 × (support tickets started) ÷ (tickets started)`
- **Kanban:** applies — support is measured on all boards.

---

## 4. Combining Boards (Org-Wide Pooling)

The three scores are **org-wide**, produced by **pooling** rather than averaging per-board
percentages:

```
pooled score = 100 × (Σ matching tickets across boards) ÷ (Σ tickets started across boards)
```

That is, numerators and denominators are summed **across the contributing boards first**, then
the percentage is computed from those totals. Consequences:

- **Larger boards weigh proportionally more** — a board that started 40 tickets influences the
  org score more than one that started 4. (This is a deliberate choice over a simple average of
  board percentages.)
- **Stability and Roadmap pool scrum boards only** — kanban-started tickets are excluded from
  both the numerator and the denominator, so they cannot dilute those scores.
- **Support pools all boards** — scrum and kanban alike.
- A dimension is **N/A** when none of the contributing boards started any tickets that week.

---

## 5. RAG Bands (Green / Amber / Red)

Each score is classified into a colour band for at-a-glance status.

| Score                        | 🟢 Green   | 🟡 Amber   | 🔴 Red     |
| ---------------------------- | ---------- | ---------- | ---------- |
| **Stability** (higher better) | ≥ 80%      | 60–79%     | < 60%      |
| **Roadmap** (higher better)   | ≥ 80%      | 48–79%     | < 48%      |
| **Support** (lower better)    | ≤ 20%      | 21–40%     | > 40%      |

Notes:

- The Roadmap bands are relative to an **org roadmap target of 80%**: green at or above the
  target, amber down to 60% of the target (i.e. 48%), red below that.
- An **N/A** score has no band and renders as a neutral empty state.

---

## 6. The 8-Week Trend

The trend chart plots the **same three org-wide scores over the trailing 8 ISO weeks**, ending
at the selected week (oldest on the left, newest on the right). Each score is recomputed for
each week using the identical method described above.

Weeks in which a dimension has no applicable tickets appear as **gaps** in the line (they are
not drawn as zero).

---

## 7. The Ticket Breakdown Table

Below the scores and trend, a table lists **every ticket in the selected week's denominator**
(all tickets that started that week), so the scores can be audited ticket by ticket.

Columns:

- **Key** — links out to the ticket in Jira
- **Summary**
- **Board** and **Type**
- **Status**
- **Planned** — yes / no / N/A
- **On Roadmap** — yes / no / N/A
- **Support** — yes / no

For **kanban tickets**, the **Planned** and **On Roadmap** cells show **N/A** (they don't apply
to kanban), while **Support** is still shown. Tickets are sorted by board, then by key.

---

## 8. Scrum vs Kanban — Summary

| Aspect                         | Scrum boards                                      | Kanban boards                                                     |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| "Started" signal for the week  | First transition into an **In Progress** status   | First transition **onto the board** (falls back to creation date) |
| Contributes to **Stability**   | Yes                                               | **No** (N/A)                                                      |
| Contributes to **Roadmap**     | Yes                                               | **No** (N/A)                                                      |
| Contributes to **Support**     | Yes                                               | Yes                                                               |

---

## 9. Data Flow (End to End)

1. **Mirror** — Jira data is synced into an internal Postgres store (issues, change history,
   sprints, links, roadmap ideas, board configuration). The report never calls Jira live.
2. **Request** — the dashboard (or an AI assistant via the MCP tool) requests the report for a
   week: `GET /api/healthcheck?week=YYYY-Www`. If no week is given, the **last completed ISO
   week** is used.
3. **Per-board load** — for each board the system loads its work-item tickets, their status
   history, support links, roadmap links, and sprint membership **once** (no per-ticket
   queries), and prepares a reusable calculator.
4. **Compute** — for the selected week (and each of the 8 trend weeks) it builds the "started
   this week" set and counts the three numerators.
5. **Pool** — numerators and denominators are summed across the applicable boards to produce the
   three org-wide scores.
6. **Band & assemble** — RAG bands are attached, the ticket list is flattened and sorted, and the
   8-week trend is built.
7. **Display** — the dashboard renders three score cards, the trend chart, and the ticket table.

---

## 10. Configuration That Affects the Report

- **Timezone** — controls where ISO-week boundaries fall and which week is "last completed".
- **Jira base URL** — used to build the outbound ticket links in the table.
- **Per-board settings** used by the calculations:
  - In-progress status names (scrum start signal)
  - Board-entry statuses (kanban start signal)
  - Done / cancelled status names (roadmap classification)
  - Roadmap link types (roadmap membership via direct links)
  - Support epics, support labels, support link types, and triage board key (support
    classification)
- **Org roadmap target** — fixed at **80%**, used for the Roadmap RAG bands.
- **Trend window** — fixed at **8 weeks**.

---

## 11. Edge Cases

| Situation                                        | Behaviour                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| No tickets started in the week (`\|D\| = 0`)     | Score is **N/A** (not 0%)                                            |
| Only kanban tickets started                      | Stability and Roadmap are **N/A**; Support is still calculated      |
| Ticket started outside any sprint window (scrum) | Counted as **not planned** for Stability                            |
| Kanban ticket created directly on the board      | Counted, using its **creation date** as the start                   |
| Cancelled ticket                                 | Not counted as roadmap-linked                                       |
| Reopened / re-started ticket                     | Attributed to the week it **first** started                         |
| Week with no applicable tickets (trend)          | Shown as a **gap** on the trend chart                               |

---

## 12. Quick Reference

- **Denominator:** tickets whose first-ever start of work fell in the selected ISO week
  (epics and sub-tasks excluded).
- **Stability** = % of those that were planned (scrum only; higher better; green ≥ 80).
- **Roadmap** = % of those linked to a roadmap idea (scrum only; higher better; green ≥ 80).
- **Support** = % of those that were reactive support (all boards; lower better; green ≤ 20).
- **Pooling:** sum across boards, then divide — larger boards weigh more.
- **Trend:** same three scores over the trailing 8 weeks.
