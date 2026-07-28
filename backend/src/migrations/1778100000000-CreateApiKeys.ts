import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CreateApiKeys — per-user API keys for programmatic access (proposal 0075, ADR 0069).
 *
 * Stores only the SHA-256 hash of each key. FK to users with ON DELETE CASCADE
 * so deleting a user revokes their keys.
 */
export class CreateApiKeys1778100000000 implements MigrationInterface {
  name = 'CreateApiKeys1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"      uuid NOT NULL,
        "name"        varchar NOT NULL,
        "keyHash"     varchar NOT NULL,
        "lastUsedAt"  timestamptz,
        "revokedAt"   timestamptz,
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_keys" PRIMARY KEY ("id"),
        CONSTRAINT "FK_api_keys_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_api_keys_keyHash" ON "api_keys" ("keyHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_api_keys_userId" ON "api_keys" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_api_keys_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_api_keys_keyHash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_keys"`);
  }
}
