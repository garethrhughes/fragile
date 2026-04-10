import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('board_configs')
export class BoardConfig {
  @PrimaryColumn()
  boardId!: string;

  @Column({ default: 'scrum' })
  boardType!: string; // 'scrum' | 'kanban'

  @Column('simple-array', { default: 'Done,Closed,Released' })
  doneStatusNames!: string[];

  @Column('simple-json', { default: '["Bug","Incident"]' })
  failureIssueTypes!: string[];

  @Column('simple-json', { default: '["is caused by","caused by"]' })
  failureLinkTypes!: string[];

  @Column('simple-json', { default: '["regression","incident","hotfix"]' })
  failureLabels!: string[];

  @Column('simple-json', { default: '["Bug","Incident"]' })
  incidentIssueTypes!: string[];

  @Column('simple-json', { default: '["Done","Resolved"]' })
  recoveryStatusNames!: string[];

  @Column('simple-json', { default: '[]' })
  incidentLabels!: string[];

  @Column({ type: 'simple-json', default: '["Critical"]' })
  incidentPriorities!: string[];

  /**
   * Status IDs (not names) that represent the backlog / pre-board state for
   * Kanban boards.  Issues whose current statusId is in this list have never
   * been pulled onto the board and should be excluded from flow metrics.
   * When empty the fallback heuristic (no status changelog = backlog) is used.
   */
  @Column({ type: 'simple-json', default: '[]' })
  backlogStatusIds!: string[];
}
