import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacklogStatusIds1775820879077 implements MigrationInterface {
  name = 'AddBacklogStatusIds1775820879077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "board_configs" ADD COLUMN IF NOT EXISTS "backlogStatusIds" TEXT NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "board_configs" DROP COLUMN IF EXISTS "backlogStatusIds"`,
    );
  }
}
