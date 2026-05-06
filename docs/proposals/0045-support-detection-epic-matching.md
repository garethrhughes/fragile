# 0045 — Support Detection: Epic-Based Classification

**Date:** 2026-05-06
**Status:** Accepted
**Author:** Architect Agent
**Related feature:** docs/features/0001-support-detection-epic-matching.md
**Related ADRs:** Will produce ADR 0047 on acceptance.

---

## 1. Problem / Motivation

Support detection currently classifies tickets via two signals: label match (`supportLabels`) and issue-link match (`supportLinkType` + `triageBoardKey`). Teams that organise their support work under dedicated Jira epics rather than labels or links have no way to use this classification accurately. The missing signal is: *does this ticket belong to one of a configured set of epic keys?*

---

## 2. Proposed Solution

Add a third, optional classification signal — **epic match** — using the existing `JiraIssue.epicKey` column. The board-level configuration gains a `supportEpics: string[]` field. During support detection, a ticket is classified as support work if **any one** of the following is true (OR semantics):

1. **Epic match** — `issue.epicKey` is in `supportEpics` (case-insensitive)
2. **Label match** — existing `supportLabels` logic (unchanged)
3. **Link match** — existing `supportLinkType` + `triageBoardKey` logic (unchanged)

The `matchReason` field is extended from `'label' | 'link' | 'both'` to a richer union that can express any combination of the three signals.

---

## 3. Design Details

### 3.1 `matchReason` Type

Replace the current three-value union with a seven-value union covering all non-empty subsets of `{epic, label, link}`:

```typescript
export type SupportMatchReason =
  | 'epic'
  | 'label'
  | 'link'
  | 'epic+label'
  | 'epic+link'
  | 'label+link'
  | 'epic+label+link'
```

`'both'` is retired in favour of explicit combination strings. This is a **breaking change** to the API response shape — existing consumers displaying `'both'` will now receive `'label+link'`. The frontend match badge must handle all seven values.

### 3.2 Entity — `BoardConfig`

Add one column:

```typescript
@Column({ type: 'simple-json', default: '[]' })
supportEpics!: string[];
```

Epic keys stored in upper-case by convention (normalised on write in the service/DTO layer). Comparison in `SupportService` is case-insensitive to be defensive.

### 3.3 Migration

New migration file `TIMESTAMP-AddSupportEpicsToBoardConfig.ts`:

```sql
-- up
ALTER TABLE board_configs
  ADD COLUMN IF NOT EXISTS "supportEpics" text NOT NULL DEFAULT '[]';

-- down
ALTER TABLE board_configs
  DROP COLUMN IF EXISTS "supportEpics";
```

### 3.4 `UpdateBoardConfigDto`

```typescript
@ApiPropertyOptional({ type: [String], example: ['PROJ-1', 'PROJ-2'] })
@IsOptional()
@IsArray()
@IsString({ each: true })
supportEpics?: string[];
```

No transformation to upper-case in the DTO — normalisation deferred to the service to keep the DTO a pure validator.

### 3.5 `SupportService` — Detection Logic

Read the new config value alongside the existing ones:

```typescript
const supportEpics: string[] = (config?.supportEpics ?? []).map((e) =>
  e.toUpperCase(),
);
```

Classification block (replaces lines 275–293 in `support.service.ts`):

```typescript
const epicMatch =
  supportEpics.length > 0 &&
  issue.epicKey != null &&
  supportEpics.includes(issue.epicKey.toUpperCase());

const labelMatch =
  supportLabels.length > 0 &&
  Array.isArray(issue.labels) &&
  (issue.labels as string[]).some((l) => supportLabels.includes(l));

const linkMatch =
  supportLinkType !== null &&
  triagePrefix !== null &&
  (linksByIssue.get(issue.key) ?? []).some(
    (lnk) =>
      lnk.linkTypeName === supportLinkType &&
      lnk.targetIssueKey.startsWith(triagePrefix),
  );

if (!epicMatch && !labelMatch && !linkMatch) continue;

const reasons: string[] = [];
if (epicMatch) reasons.push('epic');
if (labelMatch) reasons.push('label');
if (linkMatch) reasons.push('link');
const matchReason = reasons.join('+') as SupportMatchReason;
```

No other changes to the detection loop.

### 3.6 Frontend — `BoardConfig` Interface (`api.ts`)

Add:

```typescript
supportEpics: string[];
```

Extend `SupportMatchReason`:

```typescript
export type SupportMatchReason =
  | 'epic'
  | 'label'
  | 'link'
  | 'epic+label'
  | 'epic+link'
  | 'label+link'
  | 'epic+label+link'
```

### 3.7 Frontend — Settings UI (`settings/page.tsx`)

Add a `CsvField` input for **Support Epics** in the "Support Detection" section, positioned above the existing Support Labels field:

```tsx
<CsvField
  label="Support Epics"
  value={config.supportEpics}
  onChange={(v) => updateField('supportEpics', v)}
  placeholder="e.g. PROJ-1, PROJ-2"
  helpText="Epic keys whose child tickets count as support work."
/>
```

### 3.8 Frontend — Support Page Match Badge (`support/page.tsx`)

The badge at line 534 already renders `{ticket.matchReason}` with `capitalize`. The new values (`'epic'`, `'epic+label'`, etc.) will render correctly as-is. No structural change needed — only verify the display is acceptable for multi-part strings like `'epic+label+link'`.

---

## 4. Acceptance Criteria

- Given `supportEpics: ['PROJ-1']` on a board config, when a ticket has `epicKey = 'PROJ-1'`, then it is classified as support work with `matchReason = 'epic'`.
- Given `supportEpics: ['PROJ-1']` and `supportLabels: ['support']` both configured, when a ticket matches both, then `matchReason = 'epic+label'`.
- Given a ticket with no epic, label, or link match, then it is not classified as support.
- Given `supportEpics: []` (empty), the epic signal is disabled and existing behaviour is unchanged.
- Given the settings page, when a user enters `PROJ-1, PROJ-2` in the Support Epics field, the values are saved and re-displayed correctly.
- Given the support page ticket table, when a ticket matched by epic only, the Match badge displays `epic`.
- Given the existing `'label+link'` combination (formerly `'both'`), the badge displays `label+link`.
- All existing label-only and link-only test cases continue to pass.

---

## 5. Alternatives Considered

### 5.1 Keep `'both'` and add separate `epicMatch` boolean
Rejected — the `matchReason` field would become inconsistent (string union + boolean sidecar). A single composite string is cleaner.

### 5.2 Store `matchReason` as `string[]`
Considered — an array is more extensible but would require changes to the Swagger schema, frontend types, and badge rendering logic. The composite string approach (`'epic+label'`) is simpler and sufficient for the current three signals.

### 5.3 Resolve epic keys to epic summaries at classification time
Rejected — requires an additional DB query per issue. Epic keys are sufficient for matching; human-readable labels can be derived in the UI if needed.

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `JiraIssue.epicKey` may be null for tickets that were not synced with the epic custom field populated | Epic match skips null `epicKey` gracefully — no false positives |
| Renaming `'both'` → `'label+link'` is a breaking API change | Frontend and consumers are in the same repo; both are updated atomically in the same PR |
| Seven-value union may be confusing to future maintainers | The union is fully enumerated in the type definition with a comment |

---

## 7. Infrastructure Addendum

No infrastructure changes. No new cloud resources, IAM policies, secrets, or network configuration required.

---

## 8. Open Questions

None.
