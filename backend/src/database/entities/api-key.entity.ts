import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * ApiKey — a personal, per-user API key for programmatic access (proposal 0075).
 *
 * Only the SHA-256 hash of the key is stored; the raw key is shown once at
 * creation and never persisted. A key inherits its owning user's role at
 * request time (looked up live), so demoting/removing the user weakens the key.
 */
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning user id (FK → users.id). */
  @Index()
  @Column('uuid')
  userId!: string;

  /** User-supplied label to identify the key (e.g. "MCP on my laptop"). */
  @Column()
  name!: string;

  /** SHA-256 hex digest of the raw key. Never the raw key itself. */
  @Index({ unique: true })
  @Column()
  keyHash!: string;

  /** Updated on each successful use. Null until first used. */
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  /** Set when revoked; null means active. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
