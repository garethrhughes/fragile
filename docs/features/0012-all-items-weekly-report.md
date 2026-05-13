# 0012 — All Items Weekly Report

**Date:** 2026-05-13
**Status:** In Progress
**Source:** Manual
**Related proposal:** docs/proposals/0062-all-items-weekly-report.md

## Summary

A new "All Items" report accessible from the left-hand navigation, providing a weekly
cross-board view of issue activity: what was started, what was added mid-sprint (or
flagged as a kanban add for Kanban boards), what was completed, and whether each ticket
sits on the roadmap. Includes per-board health scoring and filtering capabilities.

## Background / Motivation

Stakeholders need a single weekly pulse view across all boards to understand throughput,
mid-sprint disruption, and roadmap alignment without navigating board-by-board. This is a
bespoke report for internal MyPass use and will not be upstreamed — it is kept fully
isolated from existing reports and calculations.

## Scope

**In scope**
- New backend module/service (`all-items`) — fully isolated, no modifications to existing services
- Weekly period selection across all configured boards
- Per-issue status: started, added mid-sprint (or "kanban add"), completed
- Roadmap coverage flag per item (reuses existing logic: completed within committed roadmap item date range)
- Exclusion of epics from all results
- Filters: added mid-sprint, not on roadmap, support items, TTB support items
- Per-board health score for the period based on roadmap coverage, support proportion, and mid-sprint adds
- New frontend page and left-nav entry

**Out of scope**
- Modification of any existing report, metric, or calculation
- Sprint-level granularity (this report is weekly only)
- Historical trend charts (may be added later)
- Upstreaming or generalising this report for other consumers

## Acceptance Criteria

- Given a week is selected, when the report loads, then it shows started/added/completed items across all boards
- Given an item was added mid-sprint, it is flagged accordingly; for Kanban boards the add is flagged as "kanban add"
- Given an item is completed, its roadmap status is derived using existing roadmap coverage logic (completed within committed roadmap item date)
- Given the report is loaded, filters are available for: added mid-sprint, not on roadmap, support items, TTB support items
- Given a board and week period, a health score is displayed per board, derived from roadmap coverage, support item proportion, and mid-sprint adds
- Epics are never included in any result set
- No existing report, service, or calculation is modified to support this feature

## Open Questions

1. How should the health score be weighted? (Proposed: equal thirds — roadmap alignment, support ratio, mid-sprint add ratio)
2. What defines a "support item" and "TTB support item"? (Assumed: reuse existing board config `supportIssueTypes`/labels or similar)

## Notes

- This report is explicitly for MyPass internal use only. It will never be upstreamed.
- Keep the implementation fully isolated — new module, new service, new route — to avoid coupling with existing metric calculations.
- Reuse read-only queries against existing entities (JiraIssue, JiraChangelog, JiraSprint, BoardConfig, RoadmapConfig) but do not modify or extend them.
