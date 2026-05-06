import type { CycleTimeBand } from '../../metrics/cycle-time-bands.js';

/**
 * All non-empty subsets of the three classification signals {epic, label, link}.
 * Replaces the previous `'label' | 'link' | 'both'` union.
 * `'both'` is retired — the equivalent is now `'label+link'`.
 */
export type SupportMatchReason =
  | 'epic'
  | 'label'
  | 'link'
  | 'epic+label'
  | 'epic+link'
  | 'label+link'
  | 'epic+label+link';

export interface SupportTicketDto {
  issueKey: string;
  summary: string;
  issueType: string;
  boardId: string;
  cycleTimeDays: number | null;
  completedAt: string | null;
  startedAt: string | null;
  band: CycleTimeBand | null;
  jiraUrl: string;
  /** How this ticket was identified — one or more signals joined by '+' */
  matchReason: SupportMatchReason;
}

export interface SupportResult {
  boardId: string;
  totalIssues: number;
  supportIssues: number;
  supportPercentage: number;
  p50Days: number;
  p95Days: number;
  tickets: SupportTicketDto[];
}

export interface SupportBoardBreakdown {
  boardId: string;
  supportIssues: number;
  totalIssues: number;
  percentage: number;
}

export interface SupportSummaryDto {
  totalIssues: number;
  supportIssues: number;
  supportPercentage: number;
  p50Days: number;
  p95Days: number;
  byBoard: SupportBoardBreakdown[];
}
