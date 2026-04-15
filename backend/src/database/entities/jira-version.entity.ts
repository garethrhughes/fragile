import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('jira_versions')
@Index(['projectKey'])
@Index(['projectKey', 'releaseDate'])
export class JiraVersion {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'timestamptz', nullable: true })
  releaseDate!: Date | null;

  @Column()
  projectKey!: string;

  @Column({ default: false })
  released!: boolean;
}
