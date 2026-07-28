import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiKey } from '../database/entities/api-key.entity.js';
import { User } from '../database/entities/user.entity.js';
import { ApiKeysService } from './api-keys.service.js';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let apiKeyRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    apiKeyRepo = {
      create: jest.fn().mockImplementation((d) => ({ id: 'k1', createdAt: new Date(), ...d })),
      save: jest.fn().mockImplementation((k) => Promise.resolve(k)),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    userRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: getRepositoryToken(ApiKey), useValue: apiKeyRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(ApiKeysService);
  });

  describe('create', () => {
    it('returns a raw key once and stores only its sha256 hash', async () => {
      const result = await service.create('user-1', 'My key');

      expect(result.rawKey).toMatch(/^frg_/);
      const savedArg = apiKeyRepo.save.mock.calls[0][0];
      // The stored hash matches sha256(rawKey); the raw key is never stored.
      expect(savedArg.keyHash).toBe(
        createHash('sha256').update(result.rawKey).digest('hex'),
      );
      expect(savedArg.keyHash).not.toBe(result.rawKey);
    });
  });

  describe('verify', () => {
    it('returns the owning user for a valid, non-revoked key', async () => {
      const raw = 'frg_testkey';
      const hash = createHash('sha256').update(raw).digest('hex');
      apiKeyRepo.findOne.mockResolvedValue({ id: 'k1', userId: 'u1', keyHash: hash, revokedAt: null });
      userRepo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'admin' } as User);

      const user = await service.verify(raw);

      expect(user?.id).toBe('u1');
      expect(apiKeyRepo.findOne).toHaveBeenCalledWith({ where: { keyHash: hash, revokedAt: expect.anything() } });
    });

    it('returns null for a key without the frg_ prefix', async () => {
      expect(await service.verify('not-a-key')).toBeNull();
      expect(apiKeyRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns null when the key hash is not found (unknown/revoked)', async () => {
      apiKeyRepo.findOne.mockResolvedValue(null);
      expect(await service.verify('frg_unknown')).toBeNull();
    });

    it('returns null when the owning user no longer exists', async () => {
      apiKeyRepo.findOne.mockResolvedValue({ id: 'k1', userId: 'gone', keyHash: 'h', revokedAt: null });
      userRepo.findOne.mockResolvedValue(null);
      expect(await service.verify('frg_orphan')).toBeNull();
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on a key the user owns', async () => {
      const key = { id: 'k1', userId: 'u1', revokedAt: null };
      apiKeyRepo.findOne.mockResolvedValue(key);

      await service.revoke('u1', 'k1');

      expect(key.revokedAt).toBeInstanceOf(Date);
      expect(apiKeyRepo.save).toHaveBeenCalledWith(key);
    });

    it('throws NotFound when the key is not the user\'s / does not exist', async () => {
      apiKeyRepo.findOne.mockResolvedValue(null);
      await expect(service.revoke('u1', 'nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listForUser', () => {
    it('returns metadata only (no keyHash, no raw key)', async () => {
      apiKeyRepo.find.mockResolvedValue([
        { id: 'k1', name: 'A', lastUsedAt: null, createdAt: new Date(), keyHash: 'secret', userId: 'u1' },
      ]);
      const list = await service.listForUser('u1');
      expect(list[0]).not.toHaveProperty('keyHash');
      expect(list[0].id).toBe('k1');
    });
  });
});
