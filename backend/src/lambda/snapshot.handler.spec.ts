/**
 * snapshot.handler.spec.ts
 *
 * Unit tests for the thin Lambda entrypoint (proposal 0084). The handler no
 * longer computes anything — it boots a Nest standalone context (once, cached)
 * and delegates to SnapshotComputeService. These tests assert that delegation;
 * the computation itself is tested in snapshot-compute.service.spec.ts.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Mocks — declared before importing the handler ───────────────────────────

const mockComputeBoard = jest.fn<(boardId: string) => Promise<void>>().mockResolvedValue(undefined);
const mockComputeOrg = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockContextGet = jest.fn<(token: unknown) => unknown>().mockReturnValue({
  computeBoard: mockComputeBoard,
  computeOrg: mockComputeOrg,
});
const mockCreateContext = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ get: mockContextGet });

jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: mockCreateContext },
}));

// Secrets Manager — the handler resolves the DB password before boot.
const mockSecretsSend = jest
  .fn<() => Promise<{ SecretString: string }>>()
  .mockResolvedValue({ SecretString: 'test-password' });
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn().mockImplementation((p: unknown) => p),
}));

// SnapshotComputeService is only used as a DI token by ctx.get() — a light stub.
jest.mock('../snapshot/snapshot-compute.service.js', () => ({
  SnapshotComputeService: class {},
}));
// The worker module is a DI token passed to createApplicationContext — stub it.
jest.mock('./snapshot-worker.module.js', () => ({ SnapshotWorkerModule: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('./snapshot.handler.js') as {
  handler: (event: { boardId: string; orgSnapshot?: boolean }) => Promise<void>;
};

describe('snapshot Lambda handler (thin adapter)', () => {
  beforeEach(() => {
    mockComputeBoard.mockClear();
    mockComputeOrg.mockClear();
    mockContextGet.mockClear();
    // NOTE: mockCreateContext is intentionally NOT cleared — the handler caches
    // the Nest context module-scoped, so it is created once for the whole file
    // (the warm-container reuse this asserts).
    process.env['DB_PASSWORD_SECRET_ARN'] = 'arn:aws:secretsmanager:ap-southeast-2:123:secret:test';
  });

  it('delegates a per-board event to SnapshotComputeService.computeBoard', async () => {
    await handler({ boardId: 'ACC' });
    expect(mockComputeBoard).toHaveBeenCalledWith('ACC');
    expect(mockComputeOrg).not.toHaveBeenCalled();
  });

  it('delegates an org event to SnapshotComputeService.computeOrg', async () => {
    await handler({ boardId: '__org__', orgSnapshot: true });
    expect(mockComputeOrg).toHaveBeenCalledTimes(1);
    expect(mockComputeBoard).not.toHaveBeenCalled();
  });

  it('creates the Nest context at most once across warm invocations (cached)', async () => {
    await handler({ boardId: 'ACC' });
    await handler({ boardId: 'BPT' });
    await handler({ boardId: '__org__', orgSnapshot: true });
    // Context is module-scoped and cached — created once for the whole test file
    // (booted by the first handler call in any test), never per invocation.
    expect(mockCreateContext).toHaveBeenCalledTimes(1);
  });
});
