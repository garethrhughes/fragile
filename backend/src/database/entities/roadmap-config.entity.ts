import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('roadmap_configs')
export class RoadmapConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  jpdKey!: string;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
