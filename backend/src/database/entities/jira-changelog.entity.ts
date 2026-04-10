import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('jira_changelogs')
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
