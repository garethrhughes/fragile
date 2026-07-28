import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity.js';
import { AuthService } from './auth.service.js';

// Mock google-auth-library so we can control verifyIdToken's returned payload.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

function makeConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_ALLOWED_DOMAIN: 'mypass.com',
    SESSION_SECRET: 'test-secret-key',
    SESSION_MAX_AGE_MS: 3600000,
    ...overrides,
  };
  return {
    get: jest.fn((key: string, def?: unknown) => (key in values ? values[key] : def)),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  async function buildService(configOverrides: Record<string, unknown> = {}): Promise<AuthService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ConfigService, useValue: makeConfig(configOverrides) },
      ],
    }).compile();
    return module.get(AuthService);
  }

  beforeEach(async () => {
    mockVerifyIdToken.mockReset();
    userRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ id: 'new-id', ...data })),
      save: jest.fn().mockImplementation((user) => Promise.resolve(user)),
    };

    service = await buildService();
  });

  describe('validateAndUpsertUser', () => {
    it('creates user with role admin when no admin exists', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(0);

      const result = await service.validateAndUpsertUser({
        email: 'first@mypass.com',
        name: 'First User',
        avatarUrl: null,
      });

      expect(result.role).toBe('admin');
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('creates user with role user when an admin exists', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(1);

      const result = await service.validateAndUpsertUser({
        email: 'second@mypass.com',
        name: 'Second User',
        avatarUrl: null,
      });

      expect(result.role).toBe('user');
    });

    it('updates existing user name/avatar/lastLogin without changing role', async () => {
      const existing = {
        id: 'existing-id',
        email: 'existing@mypass.com',
        name: 'Old Name',
        avatarUrl: null,
        role: 'user',
        lastLoginAt: null,
      };
      userRepo.findOne.mockResolvedValue(existing);

      const result = await service.validateAndUpsertUser({
        email: 'existing@mypass.com',
        name: 'New Name',
        avatarUrl: 'https://pic.com/avatar.jpg',
      });

      expect(result.name).toBe('New Name');
      expect(result.avatarUrl).toBe('https://pic.com/avatar.jpg');
      expect(result.role).toBe('user'); // unchanged
      expect(result.lastLoginAt).toBeInstanceOf(Date);
    });
  });

  describe('signToken / verifyToken', () => {
    it('produces a token that verifies back to the same payload', async () => {
      const user = { id: 'u1', email: 'test@mypass.com', role: 'admin' } as User;
      const token = service.signToken(user);
      const payload = service.verifyToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe('u1');
      expect(payload!.email).toBe('test@mypass.com');
      expect(payload!.role).toBe('admin');
    });

    it('returns null for an invalid token', () => {
      expect(service.verifyToken('garbage')).toBeNull();
    });
  });

  describe('verifyGoogleToken — domain restriction', () => {
    function mockPayload(payload: Record<string, unknown> | null) {
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });
    }

    it('accepts a token whose hd matches the allowed domain', async () => {
      mockPayload({ email: 'a@mypass.com', name: 'A', picture: null, hd: 'mypass.com' });
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(1);

      const { user, token } = await service.verifyGoogleToken('valid-id-token');

      expect(user.email).toBe('a@mypass.com');
      expect(token).toBeTruthy();
    });

    it('rejects a token from a different domain', async () => {
      mockPayload({ email: 'attacker@evil.com', name: 'X', picture: null, hd: 'evil.com' });

      await expect(service.verifyGoogleToken('evil-token')).rejects.toThrow(/not allowed/);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a token with no hosted-domain claim (personal Gmail)', async () => {
      mockPayload({ email: 'someone@gmail.com', name: 'G', picture: null });

      await expect(service.verifyGoogleToken('gmail-token')).rejects.toThrow(/not allowed/);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a token with no payload', async () => {
      mockPayload(null);
      await expect(service.verifyGoogleToken('empty-token')).rejects.toThrow(/Invalid token payload/);
    });
  });

  describe('fail-closed startup validation', () => {
    it('refuses to start when GOOGLE_ALLOWED_DOMAIN is empty', async () => {
      await expect(buildService({ GOOGLE_ALLOWED_DOMAIN: '' })).rejects.toThrow(
        /GOOGLE_ALLOWED_DOMAIN must be set/,
      );
    });

    it('refuses to start when SESSION_SECRET is empty', async () => {
      await expect(buildService({ SESSION_SECRET: '' })).rejects.toThrow(
        /SESSION_SECRET must be set/,
      );
    });

    it('refuses to start when SESSION_SECRET is the default placeholder', async () => {
      await expect(buildService({ SESSION_SECRET: 'change-me' })).rejects.toThrow(
        /SESSION_SECRET must be set/,
      );
    });

    it('refuses to start when GOOGLE_CLIENT_ID is empty', async () => {
      await expect(buildService({ GOOGLE_CLIENT_ID: '' })).rejects.toThrow(
        /GOOGLE_CLIENT_ID must be set/,
      );
    });
  });
});
