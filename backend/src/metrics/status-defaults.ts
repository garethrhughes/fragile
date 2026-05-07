/**
 * Default in-progress status names used when a `BoardConfig.inProgressStatusNames`
 * override is not provided.
 *
 * Centralised here (proposal 0055, C-1) to remove duplicated literal lists
 * across `lead-time.service.ts`, `mttr.service.ts`, and `sprint-detail.service.ts`.
 *
 * Names are matched case-sensitively against `JiraChangelog.toValue` /
 * `JiraIssue.status`. The mixed-case variants are intentional — Jira workflows
 * across our boards include each spelling literally.
 */
export const DEFAULT_IN_PROGRESS_NAMES: readonly string[] = [
  'In Progress',
  'In Review',
  'Peer-Review',
  'Peer Review',
  'PEER REVIEW',
  'PEER CODE REVIEW',
  'Ready for Review',
  'In Test',
  'IN TEST',
  'QA',
  'QA testing',
  'QA Validation',
  'IN TESTING',
  'Under Test',
  'ready to test',
  'Ready for Testing',
  'READY FOR TESTING',
  'Ready for Release',
  'Ready for release',
  'READY FOR RELEASE',
  'Awaiting Release',
  'READY',
];
