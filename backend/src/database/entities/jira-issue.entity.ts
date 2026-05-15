import {
  Entity,
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('jira_issues')
@Index(['boardId'])
@Index(['issueType'])
@Index(['status'])
export class JiraIssue {
  @PrimaryColumn()
  key!: string;

  @Column()
  summary!: string;

  @Column()
  status!: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  statusId!: string | null;

  @Column()
  issueType!: string;

  @Column({ type: 'varchar', nullable: true })
  fixVersion!: string | null;

  @Column({ type: 'float', nullable: true })
  points!: number | null;

  @Column()
  boardId!: string;

  @Column({ type: 'varchar', nullable: true })
  epicKey!: string | null;

  @Column('simple-json', { default: '[]' })
  labels!: string[];

  @Column({ type: 'varchar', nullable: true, default: null })
  priority!: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  assignee!: string | null;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * True if the issue is currently in the Jira board backlog (not on the
   * active board). Populated during kanban sync via the Agile backlog API
   * (ADR 0067). Always false for scrum issues.
   */
  @Column({ type: 'boolean', default: false })
  inBacklog!: boolean;
}
