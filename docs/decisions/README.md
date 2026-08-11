# Decision Log

This directory contains Architecture Decision Records (ADRs) for the Fragile
DORA & Planning Metrics Dashboard project. Each file documents a significant
technical or architectural decision, the options that were considered, and the
rationale for the choice made.

ADRs are append-only. Superseded decisions are marked `Superseded by [NNNN]` and
a new ADR is created for the replacement decision.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-use-jira-fix-versions-as-deployment-signal.md) | Use Jira fix versions as primary deployment signal with done-status fallback | Accepted | 2026-04-10 |
| [0002](0002-cache-jira-data-in-postgres.md) | Cache Jira data in Postgres rather than querying live per request | Accepted | 2026-04-10 |
| [0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) | Per-board configurable rules for CFR and MTTR stored in BoardConfig entity | Accepted | 2026-04-10 |
| [0004](0004-single-user-api-key-auth.md) | Single-user API key auth via Passport HeaderAPIKeyStrategy | Superseded by [0020](0020-no-application-level-authentication.md) | 2026-04-10 |
| [0005](0005-kanban-boards-excluded-from-planning-accuracy.md) | Kanban boards excluded from planning accuracy report | Accepted | 2026-04-10 |
| [0006](0006-sprint-membership-reconstructed-from-changelog.md) | Sprint membership at start date reconstructed from Jira changelog | Accepted | 2026-04-10 |
| [0007](0007-monorepo-backend-frontend-directories.md) | Monorepo with backend/ and frontend/ directories (not apps/api + apps/web) | Accepted | 2026-04-10 |
| [0008](0008-tailwind-css-v4-css-first-configuration.md) | Tailwind CSS v4 with CSS-first configuration (no tailwind.config.js) | Accepted | 2026-04-10 |
| [0009](0009-roadmap-accuracy-jpd-sync-strategy.md) | Roadmap Accuracy: JPD sync and metric calculation strategy | Accepted | 2026-04-10 |
| [0010](0010-kanban-roadmap-accuracy-via-changelog-board-entry-date.md) | Kanban roadmap accuracy via changelog board-entry date and quarter bucketing | Accepted | 2026-04-10 |
| [0011](0011-delivery-link-filtering-scoped-to-epic-issue-type.md) | Delivery link filtering scoped to Epic issue type only | Accepted | 2026-04-10 |
| [0012](0012-roadmap-accuracy-query-correctness-scoped-ideas-and-n-plus-one-fix.md) | Roadmap accuracy query correctness: scoped idea loading and N+1 elimination | Accepted | 2026-04-10 |
| [0013](0013-board-id-required-on-accuracy-endpoint.md) | `boardId` made required on the roadmap accuracy endpoint | Accepted | 2026-04-10 |
| [0014](0014-sprint-detail-view.md) | Sprint Detail View: new SprintModule with per-issue annotation endpoint | Accepted | 2026-04-10 |
| [0015](0015-board-config-as-metric-filter-composition-point.md) | BoardConfig as the sole composition point for metric filter rules | Proposed | 2026-04-10 |
| [0016](0016-quarter-detail-view.md) | Calendar-period drill-down as a first-class view pattern | Proposed | 2026-04-10 |
| [0017](0017-kanban-backlog-inflation-fix.md) | Kanban backlog inflation fix: statusId storage, per-board backlog config, and two-tier exclusion logic | Accepted | 2026-04-11 |
| [0018](0018-exclude-epics-and-subtasks-from-metrics.md) | Exclude Epics and Sub-tasks from all metric calculations via shared `isWorkItem()` utility | Accepted | 2026-04-12 |
| [0019](0019-broaden-in-progress-status-names-default.md) | Broaden `inProgressStatusNames` default for cycle-time start detection | Accepted | 2026-04-12 |
| [0020](0020-no-application-level-authentication.md) | No application-level authentication; CORS as sole access control | Accepted | 2026-04-12 |
| [0021](0021-jira-field-ids-externalised-to-yaml-config.md) | Jira instance-specific field IDs externalised to YAML config and singleton DB entity | Accepted | 2026-04-15 |
| [0022](0022-no-db-dependency-in-jira-client-service.md) | No DB dependency in `JiraClientService`; field IDs passed as parameters from `SyncService` | Accepted | 2026-04-15 |
| [0023](0023-jpd-delivery-link-scalar-or-array.md) | `jpdDeliveryLinkInward` / `jpdDeliveryLinkOutward` accept string or array in YAML config | Accepted | 2026-04-15 |
| [0024](0024-weekend-exclusion-from-cycle-time-and-lead-time.md) | Weekend exclusion from cycle time and lead time by default via `WorkingTimeService` | Accepted | 2026-04-15 |
| [0025](0025-mttr-uses-calendar-hours-not-working-hours.md) | MTTR uses calendar hours, not working hours | Accepted | 2026-04-15 |
| [0026](0026-hours-per-day-as-normalisation-factor.md) | `hoursPerDay` is a normalisation factor, not a clock-hour boundary | Accepted | 2026-04-15 |
| [0027](0027-day-boundary-algorithm-uses-intl-binary-search.md) | Day-boundary algorithm uses `Intl.DateTimeFormat` with binary search | Accepted | 2026-04-15 |
| [0028](0028-global-working-time-config-not-per-board.md) | Global working-time config singleton, not per-board | Accepted | 2026-04-15 |
| [0029](0029-mit-license.md) | MIT License | Accepted | 2026-04-15 |
| [0030](0030-multi-stage-docker-builds.md) | Multi-stage Docker builds for backend and frontend | Accepted | 2026-04-23 |
| [0031](0031-nextjs-standalone-output.md) | Next.js standalone output mode | Accepted | 2026-04-23 |
| [0032](0032-nodejs-heap-cap-and-apprunner-instance-sizing.md) | Node.js heap cap and ECS Fargate task sizing for memory management | Accepted | 2026-04-23 |
| [0033](0033-cloudfront-as-public-entry-point.md) | CloudFront + VPC Origin + ALB as the public entry point for both services | Accepted | 2026-04-23 |
| [0034](0034-cloudfront-waf-ip-allowlist.md) | CloudFront-scoped WAF IP allowlist as sole access-control layer | Accepted | 2026-04-23 |
| [0035](0035-nat-gateway-for-apprunner-outbound-internet.md) | NAT Gateway for ECS Fargate outbound internet access | Accepted | 2026-04-23 |
| [0036](0036-sync-endpoint-fire-and-forget-http-202.md) | `POST /api/sync` as fire-and-forget returning HTTP 202 | Accepted | 2026-04-23 |
| [0037](0037-typeorm-column-projection-for-metric-queries.md) | TypeORM column projection as standard pattern for metric service queries | Accepted | 2026-04-23 |
| [0038](0038-frontend-health-endpoint.md) | Dedicated frontend health endpoint for ECS ALB health checks | Accepted | 2026-04-23 |
| [0039](0039-carry-over-sprint-issue-classification.md) | Carry-over sprint issues classified as committed, not added | Accepted | 2026-04-24 |
| [0040](0040-lambda-post-sync-dora-snapshot-computation.md) | Lambda post-sync DORA snapshot computation | Accepted | 2026-04-25 |
| [0041](0041-postgres-advisory-lock-for-sync-serialisation.md) | PostgreSQL advisory lock for distributed sync serialisation | Accepted | 2026-04-25 |
| [0042](0042-trend-display-snapshot-type-and-org-merge-strategy.md) | `trend-display` snapshot type, org-merge-from-per-board strategy, and trend array direction | Accepted | 2026-04-25 |
| [0043](0043-ecs-fargate-replaces-app-runner.md) | ECS Fargate replaces App Runner as compute platform | Accepted | 2026-04-28 |
| [0044](0044-roadmap-coverage-via-direct-issue-links.md) | Roadmap coverage via direct Jira issue links with per-board `roadmapLinkTypes` allowlist | Accepted | 2026-05-05 |
| [0045](0045-support-ticket-report.md) | Support ticket report: per-board classification, cycle time, MCP tools | Accepted | 2026-05-06 |
| [0046](0046-support-sprint-membership-population.md) | Support Report: sprint-membership-based issue population | Accepted | 2026-05-06 |
| [0047](0047-support-detection-epic-based-classification.md) | Support Detection: epic-based classification with composite `matchReason` | Accepted | 2026-05-06 |
| [0048](0048-sync-cancelled-issues-and-multi-sprint-membership.md) | Sync: include cancelled issues via JQL and persist multi-sprint membership | Accepted | 2026-05-06 |
| [0049](0049-sprint-membership-service.md) | Single `SprintMembershipService` for sprint membership reconstruction | Accepted | 2026-05-06 |
| [0050](0050-third-audit-bug-fix-batch.md) | Third-audit clear bug-fix batch (proposal 0055): consolidate ISO-week, default in-progress names, and Sprint-changelog scan | Accepted | 2026-05-07 |
| [0051](0051-cfr-denominator-deployment-events.md) | CFR denominator: deployment events (Definition C) — DF and CFR share one unit via `deriveDeploymentEvents` | Accepted | 2026-05-07 |
| [0052](0052-disjoint-removed-set-semantics.md) | Disjoint removed-set semantics in sprint membership: split `removedKeys` into `committedRemovedKeys` + `addedRemovedKeys` with `summariseMembership()` helper | Accepted | 2026-05-07 |
| [0053](0053-sprint-report-na-propagation.md) | Sprint Report scoring: N/A propagation end-to-end with weight renormalisation; nullable `compositeScore`/`compositeBand` and new `contributingDimensions` / `excludedDimensions` / `totalWeightApplied` response fields | Accepted | 2026-05-07 |
| [0054](0054-dora-band-boundary-canonicalisation.md) | DORA band boundaries: `<` strict less-than for upper-bound bands (LT, CFR, MTTR); `>=` retained for DF; cross-suite contract via `docs/dora-bands-fixture.json` | Accepted | 2026-05-07 |
| [0055](0055-roadmap-idea-epic-conflict-resolution.md) | Roadmap idea↔epic conflict resolution: `'earliest'` target wins by default, configurable per board; shared `resolveEpicIdeas` helper across both code paths; new `GET /api/roadmap/epics` + `⚠ N conflicts` UI badge | Accepted | 2026-05-07 |
| [0056](0056-cycle-time-reopen-handling.md) | Cycle time reopen handling: shared pure `extractCycles` helper across all 4 services; representative cycle = latest completed; `reopenedIssueCount` surfaced; empty windows return `null` band (not `'excellent'`) | Accepted | 2026-05-07 |
| [0060](0060-dora-aggregate-quarter-selection-and-partial-period.md) | DORA Aggregate: quarter parameter honoured for historical quarters; `elapsedDays`, `totalDays`, `partial` added to period response; MCP `get_dora_metrics` annotates partial periods | Accepted | 2026-05-11 |
| [0061](0061-support-report-ttb-filter-and-plural-link-types.md) | Support Report: migrate `supportLinkType` to `supportLinkTypes` string array; add server-side `matchReason` filter param to `/api/support` and `/api/support/summary` | Accepted | 2026-05-12 |
| [0062](0062-kanban-stability-score-throughput-balance.md) | Kanban Stability Score: throughput balance formula `min(completed/entered, 1) * 100` replaces broken disruption-ratio for kanban boards | Accepted | 2026-05-15 |
| [0063](0063-kanban-pulse-decouple-completed-from-entry-date.md) | Kanban Pulse Report: decouple `completedCount` from board-entry working set; scan all board issues for done-transitions in week | Accepted | 2026-05-15 |
| [0064](0064-sync-deleted-jira-issues-reconciliation.md) | Sync deleted Jira issues: reconcile kanban DB against JQL response; hard-delete phantoms + cascade to changelogs, links, sprints | Accepted | 2026-05-15 |
| [0065](0065-engineering-health-check-on-the-fly-trend-and-rag-distribution.md) | Engineering Health Check: on-the-fly 4-week trend, RAG band distribution, additive `healthCheck` field on `/api/all-items` for completed weeks only | Accepted | 2026-07-28 |
| [0066](0066-sprint-effective-end-completedate.md) | Use sprint actual close time (`completeDate ?? endDate`) for completion & metric windows; scheduled `endDate` retained for selection/bucketing | Accepted | 2026-07-28 |
| [0067](0067-health-check-roadmap-targets-and-org-scores.md) | Health Check: per-team `roadmapDeliveryTarget` (default 80, PLAT 50) drives target-relative roadmap RAG banding + org attainment; org overall stability/roadmap scores | Accepted | 2026-07-28 |
| [0068](0068-google-sso-replaces-waf.md) | Google Workspace SSO auth (JWT cookie), User entity with admin/user roles, AdminGuard on Settings/sync. Amended: WAF-removal reversed — WAF + SSO coexist as defense-in-depth | Amended | 2026-07-28 |
| [0069](0069-remove-custom-reports-and-api-key-auth.md) | Remove Custom Reports (drop tables); per-user API-key auth (SHA-256 hash, Bearer, role-inheriting, session-only management); MCP read-only. Supersedes 0057–0059 | Accepted | 2026-07-28 |
| [0070](0070-healthcheck-single-denominator-model.md) | Healthcheck replaces Pulse: single per-board/week denominator (first-ever start-in-week); three comparable scores (Stability/Roadmap/Support); live-computed, no persistence. Supersedes Pulse parts of 0065/0067 | Accepted | 2026-08-03 |
| [0071](0071-healthcheck-stability-sprint-resolution.md) | Healthcheck Stability: "planned" = committedKeys OR carry-over (ADR 0039) against the sprint whose window contains the ticket's first in-progress timestamp | Accepted | 2026-08-03 |
| [0072](0072-shared-support-classifier.md) | Extract pure `classifySupport` into support/; consumed by both support.service and healthcheck.service (behaviour-preserving) | Accepted | 2026-08-03 |
| [0073](0073-healthcheck-rag-bands-and-roadmap-membership.md) | Healthcheck: Roadmap is membership (`in-scope\|linked`), not delivery; RAG bands (Stability ≥80/≥60; Roadmap vs roadmapDeliveryTarget; Support burden ≤20/≤40) | Accepted | 2026-08-03 |
| [0074](0074-healthcheck-org-wide-pooled.md) | Healthcheck is org-wide: pooled scores `(100/Σdenominator)*Σnumerator` with per-dimension denominator (Stability/Roadmap scrum-only, Support all boards); per-board data dropped. Amends 0070 | Accepted | 2026-08-03 |
| [0075](0075-remove-roadmap-delivery-target.md) | Remove unused `BoardConfig.roadmapDeliveryTarget` (no consumer after org-wide Healthcheck); Roadmap band uses fixed `ORG_ROADMAP_TARGET=80`. Supersedes target part of 0067; amends 0073 | Accepted | 2026-08-03 |
| [0076](0076-admin-ticket-debug-endpoint.md) | Admin-only, read-only `debug` module: `GET /api/debug/issue/:key` dumps all stored data for a key (issue + changelog + sprint memberships + links + roadmap ideas) from the Postgres mirror; no live Jira, no schema change; reuses AdminGuard | Accepted | 2026-08-03 |
| [0077](0077-sprint-membership-current-member-fallback.md) | Sprint membership: a `currentMemberKeys` (join-table) issue classified into no set (only out-of-window changelog, e.g. carry-over just after `completeDate`) is treated as committed. Fixes DATA-450 missing from sprint detail & planning. Refines 0049 | Accepted | 2026-08-03 |
| [0078](0078-incremental-jira-sync.md) | Incremental Jira sync (hourly cron `0 * * * *`) appends `updated >= <watermark>` to issue JQL; watermark = latest successful `SyncLog.syncedAt` − `INCREMENTAL_SYNC_OVERLAP_MINUTES` (default 5), formatted in `TIMEZONE`. `SyncLog.syncType` column; `POST /api/sync?mode=full\|incremental` (default full); first-run + kanban deletion/backlog stay full-sync-only. Complements 0036/0040/0041/0064/0067 | Accepted | 2026-08-04 |
| [0079](0079-unified-board-and-period-model.md) | DORA & Cycle Time share one filter model: single-select board + explicit "All", identical `Quarter\|Sprint\|Time period` toggle via `usePeriodFilter`/`PeriodFilterBar`; URL schema `board/mode/quarter/sprintId/window`; Sprint gated to a single Scrum board. DORA drops multi-arbitrary board select | Accepted | 2026-08-11 |
| [0080](0080-time-period-rolling-window-mode.md) | Time-period mode: first-class `window` param (7/30/90 days) ending 23:59:59.999 of the last full day in `TIMEZONE` (`windowToDates`); server-owned trend bucketing — 7d/30d daily, 90d weekly (`listRollingBuckets`) | Accepted | 2026-08-11 |
| [0081](0081-time-period-snapshots.md) | Time-period views snapshotted (recomputed on sync) for both DORA and Cycle Time. `DoraSnapshotType` gains `aggregate/trend-{7,30,90}d` (no migration); new `cycle_time_snapshots` table + `CycleTimeSnapshotReadService`. Controllers route `mode=timeperiod` to snapshots (202 pending pre-first-sync). Extends 0040 | Accepted | 2026-08-11 |
| [0082](0082-remove-cycle-time-issue-type-filter.md) | Remove the Cycle Time issue-type filter (UI + `issueType` DTO/API params + service passthrough); `CycleTimeService`'s optional `issueTypeFilter` capability retained. Unifies filtering with DORA; `isWorkItem` epic/subtask exclusion unaffected | Accepted | 2026-08-11 |
| [0083](0083-support-unified-board-and-period-model.md) | Support report adopts the shared `usePeriodFilter`/`PeriodFilterBar` (single-select board + "All", `Quarter\|Sprint\|Time period`); adds time-period mode; `resolvePeriod` refactored to `period-utils` + configured timezone. `boards`→`board`. Extends 0079/0080 | Accepted | 2026-08-11 |
| [0084](0084-support-summary-snapshots.md) | Support **summary** time-period views snapshotted on sync (per-board + org) via dedicated `support_snapshots` table + `SupportSnapshotReadService`; ticket list + quarter/sprint stay live. Lambda handler instantiates SupportService + SprintMembershipService. Extends 0040/0081 | Accepted | 2026-08-11 |
| [0085](0085-remove-support-ttb-filter.md) | Remove the Support "TTB-linked" (`matchReason`) dashboard filter (UI + DTO/API param + service application); classification, per-ticket Match column, and MCP `matchReason` retained. Relates to 0082 | Accepted | 2026-08-11 |
