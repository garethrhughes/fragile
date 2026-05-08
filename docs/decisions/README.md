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
| [0057](0057-custom-reports.md) | Custom Reports: new `custom-reports` NestJS domain with 4 TypeORM entities; REST CRUD under `/api/custom-reports/*`; 13 MCP tools; client-side filtering on `dimensions` JSONB; frontend routes `/reports` and `/reports/[slug]` | Accepted | 2026-05-08 |
| [0058](0058-custom-report-widget-rename-and-new-kinds.md) | Custom Report Widget Rename and New Widget Kinds (Table, Stat): `graph`→`widget` throughout; `table` and `stat` WidgetKind; `columns` JSONB; stat fields; `jiraBaseUrl` on report response | Accepted | 2026-05-08 |
| [0059](0059-custom-report-layout-schema.md) | Custom Report Layout Schema: typed `ReportLayout` in existing JSONB column; Zod-backed class-validator decorator; `defaultColumns` (1–6); per-widget `colSpan`; table widgets full-width by default; static Tailwind class maps to prevent purging | Accepted | 2026-05-08 |
