import { SetMetadata } from '@nestjs/common';

/** Metadata key read by AuthenticatedGuard to reject API-key auth on a route. */
export const SESSION_ONLY_KEY = 'sessionOnly';

/**
 * Marks a route as session-only: it can be reached with a Google SSO session
 * cookie but NOT with an API key. Used on the key-management endpoints so a
 * leaked API key cannot mint or list further keys (proposal 0075).
 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY_KEY, true);
