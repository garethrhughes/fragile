/**
 * Backfill script: repopulate `jira_issue_sprints` rows for issues whose
 * historical membership was wiped by the pre-fix delete-then-upsert in
 * `persistIssueSprintMembership`.
 *
 * Why this is needed
 * ------------------
 * Issues created directly into a sprint never emit a Sprint-field changelog.
 * Once such an issue is Done and its sprint closes, Jira drops the sprint from
 * `customfield_10020`. The pre-fix sync deleted the only remaining trace of
 * historical membership, causing the gap report to falsely classify these
 * issues as "never boarded" (e.g. ACC-103, SPS-461, SPS-504).
 *
 * The fix in sync.service.ts prevents *future* loss but does not retroactively
 * restore rows already deleted. This script does the recovery by calling
 * Jira's agile API endpoint `/board/{boardId}/sprint/{sprintId}/issue`, which
 * returns ALL issues that were ever assigned to a sprint (including Done
 * issues in closed sprints).
 *
 * Behaviour
 * ---------
 *   - Iterates every BoardConfig with `boardType = 'scrum'`.
 *   - For each board, iterates every JiraSprint.
 *   - For each sprint, paginates getSprintIssues and upserts a
 *     (issueKey, sprintId) row for every returned issue.
 *   - NEVER deletes — purely additive, safe to re-run.
 *   - Logs per-board and per-sprint counts, plus a final summary.
 *
 * Usage (local)
 * -------------
 *   npm run backfill:issue-sprints --prefix backend
 *
 * Usage (prod)
 * ------------
 *   ECS exec into a backend task, then:
 *     node dist/scripts/backfill-issue-sprints.js
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../app.module.js';
import { JiraClientService } from '../jira/jira-client.service.js';
import {
  BoardConfig,
  JiraSprint,
  JiraIssueSprint,
} from '../database/entities/index.js';

interface BackfillStats {
  boardsProcessed: number;
  sprintsProcessed: number;
  issuesSeen: number;
  rowsUpserted: number;
  errors: number;
}

async function backfillBoard(
  board: BoardConfig,
  sprintRepo: Repository<JiraSprint>,
  issueSprintRepo: Repository<JiraIssueSprint>,
  jiraClient: JiraClientService,
  logger: Logger,
  stats: BackfillStats,
): Promise<void> {
  const sprints = await sprintRepo.find({ where: { boardId: board.boardId } });
  logger.log(`[${board.boardId}] processing ${sprints.length} sprints`);

  for (const sprint of sprints) {
    let startAt = 0;
    let totalForSprint = 0;
    let upsertedForSprint = 0;

    // Resolve the numeric Jira board ID. BoardConfig.boardId may be a project
    // key (e.g. "ACC") or a numeric agile board ID. getSprintIssues needs
    // the numeric ID.
    let numericBoardId = board.boardId;
    if (!/^\d+$/.test(numericBoardId)) {
      try {
        const boards = await jiraClient.getBoardsForProject(board.boardId);
        const first = boards.values?.[0];
        if (!first?.id) {
          logger.warn(`[${board.boardId}] no agile boards found — skipping`);
          return;
        }
        numericBoardId = String(first.id);
      } catch (err) {
        logger.error(
          `[${board.boardId}] failed to resolve numeric board id: ${(err as Error).message}`,
        );
        stats.errors++;
        return;
      }
    }

    while (true) {
      try {
        const page = await jiraClient.getSprintIssues(
          numericBoardId,
          sprint.id,
          startAt,
        );
        const issues = page.issues ?? [];
        if (issues.length === 0) break;

        const rows: JiraIssueSprint[] = issues.map((issue) => {
          const row = new JiraIssueSprint();
          row.issueKey = issue.key;
          row.sprintId = sprint.id;
          return row;
        });

        await issueSprintRepo.upsert(rows, ['issueKey', 'sprintId']);

        totalForSprint += issues.length;
        upsertedForSprint += rows.length;
        stats.issuesSeen += issues.length;
        stats.rowsUpserted += rows.length;

        if (issues.length < 100) break;
        startAt += issues.length;
      } catch (err) {
        logger.error(
          `[${board.boardId}] sprint ${sprint.id} (${sprint.name}) failed at startAt=${startAt}: ${(err as Error).message}`,
        );
        stats.errors++;
        break;
      }
    }

    if (totalForSprint > 0) {
      logger.log(
        `[${board.boardId}] sprint ${sprint.id} (${sprint.name}): ${totalForSprint} issues, ${upsertedForSprint} rows upserted`,
      );
    }
    stats.sprintsProcessed++;
  }

  stats.boardsProcessed++;
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillIssueSprints');
  logger.log('Starting jira_issue_sprints backfill');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const stats: BackfillStats = {
    boardsProcessed: 0,
    sprintsProcessed: 0,
    issuesSeen: 0,
    rowsUpserted: 0,
    errors: 0,
  };

  try {
    const boardConfigRepo = app.get<Repository<BoardConfig>>(
      getRepositoryToken(BoardConfig),
    );
    const sprintRepo = app.get<Repository<JiraSprint>>(
      getRepositoryToken(JiraSprint),
    );
    const issueSprintRepo = app.get<Repository<JiraIssueSprint>>(
      getRepositoryToken(JiraIssueSprint),
    );
    const jiraClient = app.get(JiraClientService);

    const boards = await boardConfigRepo.find({ where: { boardType: 'scrum' } });
    logger.log(`Found ${boards.length} scrum boards to backfill`);

    for (const board of boards) {
      await backfillBoard(
        board,
        sprintRepo,
        issueSprintRepo,
        jiraClient,
        logger,
        stats,
      );
    }
  } finally {
    await app.close();
  }

  logger.log('==== Backfill complete ====');
  logger.log(`Boards processed:  ${stats.boardsProcessed}`);
  logger.log(`Sprints processed: ${stats.sprintsProcessed}`);
  logger.log(`Issues seen:       ${stats.issuesSeen}`);
  logger.log(`Rows upserted:     ${stats.rowsUpserted}`);
  logger.log(`Errors:            ${stats.errors}`);

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Backfill failed:', err);
  process.exit(1);
});
