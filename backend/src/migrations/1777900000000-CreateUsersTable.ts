import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CreateUsersTable
 *
 * Creates the `users` table for Google SSO authentication (proposal 0074).
 * Stores authenticated user profiles with role-based access control.
 */
export class CreateUsersTable1777900000000 implements MigrationInterface {
  name = 'CreateUsersTable1777900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "email"       varchar NOT NULL,
        "name"        varchar NOT NULL,
        "avatarUrl"   varchar,
        "role"        varchar NOT NULL DEFAULT 'user',
        "lastLoginAt" timestamptz,
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_email" ON "users" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
