# 0013 — Roadmap Accuracy Column Relabelling

**Date:** 2026-06-01
**Status:** Implemented
**Source:** Manual
**Related proposal:** N/A (trivial UI relabelling — no proposal required)

## Summary

Rename the roadmap accuracy report table columns from "Covered / Uncovered" to
"On-Roadmap / On-Roadmap (Late) / Off-Roadmap" and change "Coverage %" to
"On-Roadmap %" with an updated formula that includes both on-time and late items
in the numerator.

## Background / Motivation

The current "Covered" and "Uncovered" columns do not provide a clear enough picture.
"Uncovered" conflates two distinct categories: items linked to a roadmap idea but
delivered late (amber), and items with no roadmap link at all. Splitting these into
three columns gives immediate visibility into how much work is roadmap-aligned
(regardless of timeliness) versus completely off-roadmap.

The "Coverage %" metric also changes meaning — it becomes "On-Roadmap %" and answers
the question "what percentage of work is connected to the roadmap?" rather than "what
percentage was delivered on time against the roadmap?"

## Scope

**In scope**
- Rename table columns on the roadmap accuracy page (sprint, quarter, and week views)
- Add a new "On-Roadmap (Late)" column (derived from existing `linkedCount - coveredIssues`)
- Rename "Uncovered" to "Off-Roadmap" (derived from `totalIssues - linkedCount`)
- Change "Coverage %" to "On-Roadmap %" with formula `linkedCount / totalIssues * 100`
- Update summary stat card labels and chart titles to match
- Update row colouring logic to use the new On-Roadmap % formula

**Out of scope**
- Backend API changes (all data already available via existing fields)
- Sprint detail view changes
- On-Time Rate calculation (unchanged)
- Any changes to the underlying data model or calculation logic

## Acceptance Criteria

- Given the roadmap accuracy table, when rendered, then columns show: On-Roadmap, On-Roadmap (Late), Off-Roadmap (instead of Covered, Uncovered)
- Given a sprint with issues, when On-Roadmap is displayed, then it equals the count of issues linked to a roadmap idea and delivered on time (same as previous "Covered")
- Given a sprint with issues, when On-Roadmap (Late) is displayed, then it equals the count of issues linked to a roadmap idea but delivered late or still in-flight past target (amber items)
- Given a sprint with issues, when Off-Roadmap is displayed, then it equals issues with no roadmap link at all
- Given the On-Roadmap % column, when displayed, then it equals (On-Roadmap + On-Roadmap (Late)) / Total Issues * 100
- Given the On-Time Rate % column, when displayed, then it is unchanged from current behaviour
- Given the sprint detail view, when accessed, then it is unchanged

## Open Questions

None.

## Notes

The backend already returns `linkedCount` (green + amber) and `coveredIssues` (green only).
All new columns can be derived client-side from existing API response fields:
- On-Roadmap = `coveredIssues`
- On-Roadmap (Late) = `linkedCount - coveredIssues`
- Off-Roadmap = `totalIssues - linkedCount`
- On-Roadmap % = `linkedCount / totalIssues * 100`

No backend changes required.
