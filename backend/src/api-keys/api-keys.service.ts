import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes, createHash } from 'node:crypto';
import { ApiKey } from '../database/entities/api-key.entity.js';
import { User } from '../database/entities/user.entity.js';

export interface CreatedApiKey {
  id: string;
  name: string;
  /** The raw key — returned ONCE at creation, never stored or shown again. */
  rawKey: string;
  createdAt: Date;
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** Prefix makes keys identifiable in logs/config without revealing the secret. */
const KEY_PREFIX = 'frg_';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** SHA-256 hex digest — the only form of the key that is persisted. */
  private hash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  /**
   * Create a new key for a user. Returns the raw key exactly once; only its
   * hash is stored.
   */
  async create(userId: string, name: string): Promise<CreatedApiKey> {
    const rawKey = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const entity = this.apiKeyRepo.create({
      userId,
      name,
      keyHash: this.hash(rawKey),
      lastUsedAt: null,
      revokedAt: null,
    });
    const saved = await this.apiKeyRepo.save(entity);
    return { id: saved.id, name: saved.name, rawKey, createdAt: saved.createdAt };
  }

  /** List a user's non-revoked keys (metadata only — never the raw key). */
  async listForUser(userId: string): Promise<ApiKeyMetadata[]> {
    const keys = await this.apiKeyRepo.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  }

  /** Revoke a key the user owns. Throws NotFound if it isn't theirs / doesn't exist. */
  async revoke(userId: string, id: string): Promise<void> {
    const key = await this.apiKeyRepo.findOne({ where: { id, userId } });
    if (!key || key.revokedAt) {
      throw new NotFoundException('API key not found');
    }
    key.revokedAt = new Date();
    await this.apiKeyRepo.save(key);
  }

  /**
   * Verify a raw key from an Authorization header. Returns the owning User
   * (with live role) or null if the key is unknown/revoked. Updates lastUsedAt.
   */
  async verify(rawKey: string): Promise<User | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) return null;
    const keyHash = this.hash(rawKey);
    const key = await this.apiKeyRepo.findOne({
      where: { keyHash, revokedAt: IsNull() },
    });
    if (!key) return null;

    const user = await this.userRepo.findOne({ where: { id: key.userId } });
    if (!user) return null;

    // Fire-and-forget lastUsedAt update — don't block the request on it.
    key.lastUsedAt = new Date();
    void this.apiKeyRepo.save(key).catch(() => undefined);

    return user;
  }
}
