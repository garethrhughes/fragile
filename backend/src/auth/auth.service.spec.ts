import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ id: 'new-id', ...data })),
      save: jest.fn().mockImplementation((user) => Promise.resolve(user)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'GOOGLE_CLIENT_ID') return 'test-client-id';
              if (key === 'GOOGLE_ALLOWED_DOMAIN') return 'mypass.com';
              if (key === 'SESSION_SECRET') return 'test-secret-key';
              if (key === 'SESSION_MAX_AGE_MS') return 3600000;
              return def;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
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
});
