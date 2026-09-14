/**
 * check-changelog-completeness.ts
 *
 * Diagnostic for hypothesis H1 of the 2026-W35 healthcheck investigation:
 * "Fragile's stored copy of the changelog is incomplete."
 *
 * `first_start` is a minimum over the STORED changelog. If the stored copy is
 * missing its oldest entries, a ticket's apparent first start moves later and it
 * is ejected from earlier weeks — the only mechanism that shrinks a closed
 * week's denominator with no config change.
 *
 * This script compares, per issue, the number of changelog rows Fragile has
 * stored against the `total` Jira reports for that issue, and prints every
 * mismatch. Read-only against both Postgres and Jira.
 *
 *   npm run build && node dist/scripts/check-changelog-completeness.js [BOARD...]
 *
 * Requires DB_* and JIRA_* env vars (same as the app). Boards default to every
 * board in `board_configs`.
 *
 * Equivalent SQL for the stored side alone (Jira's `total` is not in the DB, so
 * the comparison itself needs the API):
 *
 *   SELECT i."boardId", i.key, count(c.id) AS stored_rows,
 *          count(c.id) FILTER (WHERE c.field = 'status') AS stored_status_rows
 *   FROM jira_issues i
 *   LEFT JOIN jira_changelogs c ON c."issueKey" = i.key
 *   GROUP BY i."boardId", i.key
 *   HAVING count(c.id) = 0
 *   ORDER BY i."boardId", i.key;   -- issues with NO stored changelog at all
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';

interface Row {
  boardId: string;
  key: string;
  stored: string;
}

async function jiraChangelogTotal(
  baseUrl: string,
  auth: string,
  key: string,
): Promise<number | null> {
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${key}/changelog?maxResults=1&startAt=0`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { total: number };
  return body.total;
}

async function main(): Promise<void> {
  const boards = process.argv.slice(2);

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'fragile',
    synchronize: false,
  });
  await ds.initialize();

  const baseUrl = (process.env.JIRA_BASE_URL ?? '').replace(/\/$/, '');
  const auth = Buffer.from(
    `${process.env.JIRA_USER_EMAIL ?? ''}:${process.env.JIRA_API_TOKEN ?? ''}`,
  ).toString('base64');

  // Stored changelog row count per issue. A `LEFT JOIN` so issues with zero
  // stored rows are reported too — those are the ones that silently vanish from
  // every week's denominator.
  const rows: Row[] = await ds.query(
    `SELECT i."boardId", i.key, count(c.id)::text AS stored
       FROM jira_issues i
       LEFT JOIN jira_changelogs c ON c."issueKey" = i.key
      ${boards.length > 0 ? 'WHERE i."boardId" = ANY($1)' : ''}
      GROUP BY i."boardId", i.key
      ORDER BY i."boardId", i.key`,
    boards.length > 0 ? [boards] : [],
  );

  console.log(`Checking ${rows.length} issue(s) against Jira...`);

  let checked = 0;
  let short = 0;
  let empty = 0;

  for (const row of rows) {
    const stored = Number(row.stored);
    if (stored === 0) empty += 1;

    const total = await jiraChangelogTotal(baseUrl, auth, row.key);
    checked += 1;
    if (total === null) {
      console.log(`  ${row.key}: Jira lookup failed (deleted or no permission)`);
      continue;
    }
    // Jira's `total` counts history ENTRIES; a stored row is one changed FIELD,
    // so stored >= total is normal. stored < total is the red flag.
    if (stored < total) {
      short += 1;
      console.log(
        `  SHORT ${row.boardId} ${row.key}: stored=${stored} jira_entries=${total}`,
      );
    }
    if (checked % 200 === 0) console.log(`  ...${checked}/${rows.length}`);
    await new Promise((r) => setTimeout(r, 100)); // respect the Jira rate limit
  }

  console.log(
    `\nDone. ${checked} checked, ${short} with fewer stored rows than Jira ` +
      `history entries, ${empty} with NO stored changelog at all.`,
  );

  await ds.destroy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
