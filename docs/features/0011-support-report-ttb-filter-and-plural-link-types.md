# 0011 — Support Report TTB Filter and Plural Link Types

**Date:** 2026-05-12
**Status:** In Progress
**Source:** Manual
**Related proposal:** docs/proposals/0060-support-report-ttb-filter-and-plural-link-types.md

## Summary

Add a filter to the support report that restricts results to only issues linked to the TTB
(triage board) project. Additionally, update the `supportLinkType` board config field from
a single string to an array (`supportLinkTypes`), allowing multiple link type names to
qualify an issue as support work.

## Background / Motivation

Currently the support report shows all issues classified as support via any of the three
detection mechanisms (epic, label, link). Users want the ability to filter the report to
show only those issues that are specifically linked to TTB — providing a narrower view of
triage-originated support work without the noise of epic- or label-matched tickets.

Separately, the `supportLinkType` field on `BoardConfig` currently accepts only a single
link type name. In practice, teams may use multiple Jira link types (e.g. "clones",
"is caused by", "relates to") to connect issues to the triage board. Supporting an array
removes the need to pick just one.

## Scope

**In scope**
- New query parameter on the support report API (`/api/support` and `/api/support/summary`)
  to filter by match reason (specifically link-based matches to TTB).
- Frontend filter control on the support report page to toggle "TTB-linked only".
- Schema migration: rename/convert `supportLinkType` (varchar, nullable) to
  `supportLinkTypes` (simple-json array) on `BoardConfig`.
- Update classification logic in `SupportService` to check against all configured link types.
- Backward compatibility: migration should preserve existing single-value configs.

**Out of scope**
- Filtering by other match reasons (epic-only, label-only) — future work.
- Changes to the MCP tools beyond passing the new filter parameter through.
- Changes to other reports or metrics that do not use `supportLinkType`.

## Acceptance Criteria

- Given a support report, when a "TTB-linked only" filter is applied, then only issues
  whose `matchReason` includes "link" are shown in results.
- Given board config, when `supportLinkTypes` is configured with multiple values, then an
  issue matching ANY of those link types (with the triage board key prefix) is classified
  as support.
- Given an existing board config with a single `supportLinkType` value, when the migration
  runs, then the value is preserved in the new `supportLinkTypes` array.

## Open Questions

None.

## Notes

- The filter is a client-side filter on the `matchReason` field — or it could be a
  server-side query parameter. Design decision to be made in the proposal.
- The plural rename is a breaking schema change requiring a TypeORM migration with both
  `up()` and `down()`.
