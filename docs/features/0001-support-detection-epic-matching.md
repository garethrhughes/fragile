# 0001 — Support Detection: Epic Matching

**Date:** 2026-05-06
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0045-support-detection-epic-matching.md

## Summary

Extend the support detection configuration to allow a comma-separated list of Jira epic keys per board. Any ticket that belongs to one of those epics is classified as support work. The match logic becomes `EPIC OR Link OR Tag`, and the match reason column reflects when an epic match triggered the classification.

## Background / Motivation

The existing support detection supports two classification signals: label-based (`supportLabels`) and link-based (`supportLinkType` + `triageBoardKey`). Teams that organise support work under specific epics rather than labels or links cannot currently use the feature accurately. Adding epic-based detection removes this gap without changing the behaviour of existing configurations.

## Scope

**In scope**
- New `supportEpics` field (array of epic keys) on `BoardConfig` entity.
- TypeORM migration to add the column.
- `SupportService` detection logic updated: classify if `epicMatch OR labelMatch OR linkMatch`.
- `matchReason` type extended to include `'epic'` and any combined values involving epic (e.g. `'epic'`, `'both'` extended or a richer enum).
- `UpdateBoardConfigDto` updated with the new field and validation.
- Frontend `BoardConfig` interface and settings UI updated with a CSV input for Support Epics.
- Match column in the support page table updated to display `epic` as a badge value.

**Out of scope**
- Changes to how epics themselves are synced or stored (existing `JiraIssue.epicKey` / parent field assumed sufficient).
- Planning accuracy, DORA, or any other metric module.
- Changes to the existing label or link detection behaviour.

## Acceptance Criteria

- Given a board with `supportEpics: ['PROJ-1', 'PROJ-2']` configured, when a ticket's epic key matches one of those values, then the ticket is classified as support work.
- Given only an epic match (no label or link match), then `matchReason` is `'epic'`.
- Given an epic match combined with a label or link match, then `matchReason` reflects the combined state (e.g. `'both'` or a richer value that includes `'epic'`).
- Given a ticket with no epic, label, or link match, then the ticket is not classified as support.
- Given the settings UI, when a user enters a comma-separated list of epic keys, then the value is saved to `supportEpics` on the board config.
- Given the support page ticket table, when a ticket was matched by epic, then the Match column badge displays `epic`.
- Given the match logic, when any one of epic, label, or link matches, the ticket is included (OR semantics).

## Open Questions

- Does `JiraIssue` currently store the parent epic key in a reliable field (e.g. `epicKey`, `parentKey`, or a custom field mapped via `JiraFieldConfig`)? This needs confirming before finalising the implementation approach.

## Notes

- Existing `matchReason: 'label' | 'link' | 'both'` type will need to be extended. The `'both'` value currently means label+link; this may need to become a more expressive type or the field may need to carry an array of reasons.
- The detection logic in `SupportService` is at `support/support.service.ts:275–293`. The `matchReason` union type is defined in `support/dto/support-response.dto.ts:14` and mirrored in `frontend/src/lib/api.ts:988`.
- Migration must implement both `up()` and `down()` per project convention.
