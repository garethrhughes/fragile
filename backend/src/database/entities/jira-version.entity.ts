import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('jira_versions')
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
