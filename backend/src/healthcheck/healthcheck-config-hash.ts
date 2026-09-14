/**
 * healthcheck-config-hash.ts
 *
 * Pure derivation of the Healthcheck **config hash** (ADR 0092): a stable
 * fingerprint of everything in board configuration that can move a week's
 * denominator or numerators.
 *
 * A stored week is only comparable to a live recompute if we know the predicate
 * configuration was the same. `inProgressStatusNames` is a mutable, unversioned
 * `board_configs` column with no audit trail, and `YamlConfigService` re-applies
 * `config/boards.yaml` (baked into the image at build time) to the database on
 * every application boot — so the predicate can change without any trace. This
 * hash makes such a change detectable after the fact.
 *
 * Order-insensitive: every list and the board set itself are sorted before
 * hashing, so a cosmetic reordering of `inProgressStatusNames` does not present
 * as drift. Status names are NOT case-normalised — the denominator predicate is
 * case-sensitive (`inProgressStatuses.has(cl.toValue)`), so a casing change is a
 * real semantic change and must change the hash.
 */
import { createHash } from 'node:crypto';
import type { BoardConfig } from '../database/entities/index.js';

/** The subset of a board's config that can move the Healthcheck denominator. */
export interface HealthcheckConfigFingerprint {
  boardId: string;
  boardType: string;
  inProgressStatusNames: string[];
  boardEntryStatuses: string[];
  doneStatusNames: string[];
  cancelledStatusNames: string[];
}

const sorted = (values: readonly string[] | null | undefined): string[] =>
  [...(values ?? [])].sort();

/** Extract the denominator-relevant fields from a board config. */
export function fingerprintBoard(config: BoardConfig): HealthcheckConfigFingerprint {
  return {
    boardId: config.boardId,
    boardType: config.boardType === 'kanban' ? 'kanban' : 'scrum',
    inProgressStatusNames: sorted(config.inProgressStatusNames),
    boardEntryStatuses: sorted(config.boardEntryStatuses),
    doneStatusNames: sorted(config.doneStatusNames),
    cancelledStatusNames: sorted(config.cancelledStatusNames),
  };
}

/**
 * SHA-256 over the sorted per-board fingerprints. The board set is part of the
 * hash by construction — adding or removing a contributing board changes it,
 * which is the "board filter identity" the stored figure must be pinned to.
 */
export function computeConfigHash(configs: readonly BoardConfig[]): string {
  const fingerprints = configs
    .map(fingerprintBoard)
    .sort((a, b) => a.boardId.localeCompare(b.boardId));
  return createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex');
}
