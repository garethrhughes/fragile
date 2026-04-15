import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('jira_changelogs')
@Index(['issueKey'])
@Index(['field'])
@Index(['issueKey', 'field'])
export class JiraChangelog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  issueKey!: string;

  @Column({ nullable: true })
  field!: string;

  @Column({ type: 'varchar', nullable: true })
  fromValue!: string | null;

  @Column({ type: 'varchar', nullable: true })
  toValue!: string | null;

  @Column({ type: 'timestamptz' })
  changedAt!: Date;
}
