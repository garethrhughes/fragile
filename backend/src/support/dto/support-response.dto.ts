import type { CycleTimeBand } from '../../metrics/cycle-time-bands.js';

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
  /** How this ticket was identified: 'label', 'link', or 'both' */
  matchReason: 'label' | 'link' | 'both';
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
