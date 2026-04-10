import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('jira_sprints')
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

  @Column()
  boardId!: string;
}
