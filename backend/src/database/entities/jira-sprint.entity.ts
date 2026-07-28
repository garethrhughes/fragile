import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('jira_sprints')
@Index(['boardId'])
@Index(['boardId', 'state'])
export class JiraSprint {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column()
  state!: string; // 'active' | 'closed' | 'future'

  @Column({ type: 'timestamptz', nullable: true })
  startDate!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endDate!: Date | null;

  /**
   * Actual sprint close time (Jira `completeDate`). Set only for closed
   * sprints; null for active/future sprints or until the next sync populates
   * it. Used as the completion/metric window upper bound (proposal 0072).
   */
  @Column({ type: 'timestamptz', nullable: true })
  completeDate!: Date | null;

  @Column()
  boardId!: string;
}
