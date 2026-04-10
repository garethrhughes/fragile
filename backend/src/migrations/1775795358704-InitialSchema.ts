import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1775795358704 implements MigrationInterface {
    name = 'InitialSchema1775795358704'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "sync_logs" ("id" SERIAL NOT NULL, "boardId" character varying NOT NULL, "syncedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "issueCount" integer NOT NULL DEFAULT '0', "status" character varying NOT NULL DEFAULT 'success', "errorMessage" text, CONSTRAINT "PK_f441fe15484e077c80ddec89336" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "jira_versions" ("id" character varying NOT NULL, "name" character varying NOT NULL, "releaseDate" TIMESTAMP WITH TIME ZONE, "projectKey" character varying NOT NULL, "released" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_7fed8c975678543e7dde347734b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "jira_sprints" ("id" character varying NOT NULL, "name" character varying NOT NULL, "state" character varying NOT NULL, "startDate" TIMESTAMP WITH TIME ZONE, "endDate" TIMESTAMP WITH TIME ZONE, "boardId" character varying NOT NULL, CONSTRAINT "PK_0b17c708e4f195c1856b35a4dcf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "jira_issues" ("key" character varying NOT NULL, "summary" character varying NOT NULL, "status" character varying NOT NULL, "issueType" character varying NOT NULL, "fixVersion" character varying, "points" double precision, "sprintId" character varying, "boardId" character varying NOT NULL, "labels" text NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3d986f8d9252d90830e30120011" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "jira_changelogs" ("id" SERIAL NOT NULL, "issueKey" character varying NOT NULL, "field" character varying, "fromValue" character varying, "toValue" character varying, "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_874c13d03ced94bd17cd0828c3e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "board_configs" ("boardId" character varying NOT NULL, "boardType" character varying NOT NULL DEFAULT 'scrum', "doneStatusNames" text NOT NULL DEFAULT 'Done,Closed,Released', "failureIssueTypes" text NOT NULL DEFAULT '["Bug","Incident"]', "failureLinkTypes" text NOT NULL DEFAULT '["is caused by","caused by"]', "failureLabels" text NOT NULL DEFAULT '["regression","incident","hotfix"]', "incidentIssueTypes" text NOT NULL DEFAULT '["Bug","Incident"]', "recoveryStatusNames" text NOT NULL DEFAULT '["Done","Resolved"]', "incidentLabels" text NOT NULL DEFAULT '[]', CONSTRAINT "PK_6792e959b11a4e755f7153835ff" PRIMARY KEY ("boardId"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "board_configs"`);
        await queryRunner.query(`DROP TABLE "jira_changelogs"`);
        await queryRunner.query(`DROP TABLE "jira_issues"`);
        await queryRunner.query(`DROP TABLE "jira_sprints"`);
        await queryRunner.query(`DROP TABLE "jira_versions"`);
        await queryRunner.query(`DROP TABLE "sync_logs"`);
    }

}
