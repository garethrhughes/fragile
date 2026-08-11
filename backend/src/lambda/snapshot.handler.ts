/**
 * snapshot.handler.ts
 *
 * Thin Lambda entrypoint for post-sync snapshot computation (proposal 0084).
 *
 * This handler contains NO snapshot computation logic. It boots a NestJS
 * standalone application context for SnapshotWorkerModule — cached module-scope
 * so it is created once per warm container and reused across invocations — then
 * resolves SnapshotComputeService and delegates to computeBoard/computeOrg. The
 * exact same service runs locally (via LambdaInvokerService's in-process
 * fallback), so prod and local produce identical snapshot rows by construction.
 *
 * The only responsibility unique to this file is resolving the DB password from
 * Secrets Manager and placing it on the environment before boot. process.env is
 * used here because this is the sanctioned Lambda entrypoint.
 */
import 'reflect-metadata';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { SnapshotWorkerModule } from './snapshot-worker.module.js';
import { SnapshotComputeService } from '../snapshot/snapshot-compute.service.js';

export interface SnapshotHandlerEvent {
  boardId: string;
  /**
   * When true, compute the org-level (__org__) snapshot across all boards.
   * Fired once after all per-board invocations. Per-board invocations leave
   * this unset.
   */
  orgSnapshot?: boolean;
}

// ── DB password cache (module-scope, reused across warm invocations) ─────────

let resolvedDbPassword: string | null = null;

async function resolveDbPassword(): Promise<string> {
  if (resolvedDbPassword !== null) return resolvedDbPassword;

  const secretArn = process.env['DB_PASSWORD_SECRET_ARN'];
  if (!secretArn) {
    throw new Error('DB_PASSWORD_SECRET_ARN environment variable is not set.');
  }

  const client = new SecretsManagerClient({
    region: process.env['AWS_REGION'] ?? 'ap-southeast-2',
  });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const secretString = response.SecretString ?? '';

  // Secret may be a JSON blob ({ password } / { DB_PASSWORD }) or a raw string.
  let password: string;
  try {
    const obj = JSON.parse(secretString) as Record<string, unknown>;
    const val = obj['password'] ?? obj['DB_PASSWORD'];
    password = typeof val === 'string' ? val : secretString;
  } catch {
    password = secretString;
  }

  resolvedDbPassword = password;
  return password;
}

// ── Nest application context (module-scope, reused across warm invocations) ──

let appContext: INestApplicationContext | null = null;

async function getContext(): Promise<INestApplicationContext> {
  if (appContext) return appContext;

  // Place the resolved DB password on the environment so the TypeORM factory
  // in SnapshotWorkerModule (identical to AppModule's) reads it via ConfigService.
  process.env['DB_PASSWORD'] = await resolveDbPassword();

  appContext = await NestFactory.createApplicationContext(SnapshotWorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  return appContext;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: SnapshotHandlerEvent): Promise<void> => {
  const label = event.orgSnapshot ? 'org-level' : `board ${event.boardId}`;
  console.log(`[snapshot-handler] Starting snapshot computation for ${label}`);

  const ctx = await getContext();
  const compute = ctx.get(SnapshotComputeService);

  if (event.orgSnapshot) {
    await compute.computeOrg();
  } else {
    await compute.computeBoard(event.boardId);
  }

  console.log(`[snapshot-handler] Snapshot computation complete for ${label}`);
  // Context and DB pool remain open — reused on the next warm invocation.
};
