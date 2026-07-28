import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service.js';
import { User } from '../database/entities/user.entity.js';

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
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((dto: Partial<User>) => dto as User),
      save: jest.fn().mockImplementation(async (u: User) => u),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ---------------------------------------------------------------------------
  // validateAndUpsertUser
  // ---------------------------------------------------------------------------

  describe('validateAndUpsertUser', () => {
    const profile = {
      email: 'alice@example.com',
      name: 'Alice',
      avatarUrl: 'https://example.com/avatar.png',
    };

    it('creates user with role admin when no admin exists', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(0);

      const result = await service.validateAndUpsertUser(profile);

      expect(userRepo.count).toHaveBeenCalledWith({ where: { role: 'admin' } });
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@example.com',
          name: 'Alice',
          avatarUrl: 'https://example.com/avatar.png',
          role: 'admin',
        }),
      );
      expect(userRepo.save).toHaveBeenCalled();
      expect(result.role).toBe('admin');
    });

    it('creates user with role user when an admin already exists', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(1);

      const result = await service.validateAndUpsertUser(profile);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'user' }),
      );
      expect(result.role).toBe('user');
    });

    it('updates name, avatarUrl, and lastLoginAt when user exists', async () => {
      const existing: Partial<User> = {
        id: 'uuid-1',
        email: 'alice@example.com',
        name: 'Old Name',
        avatarUrl: null,
        role: 'admin',
        lastLoginAt: null,
      };
      userRepo.findOne.mockResolvedValue(existing);

      const result = await service.validateAndUpsertUser(profile);

      expect(result.name).toBe('Alice');
      expect(result.avatarUrl).toBe('https://example.com/avatar.png');
      expect(result.lastLoginAt).toBeInstanceOf(Date);
      // Role must not change
      expect(result.role).toBe('admin');
      expect(userRepo.count).not.toHaveBeenCalled();
      expect(userRepo.create).not.toHaveBeenCalled();
      expect(userRepo.save).toHaveBeenCalledWith(existing);
    });

    it('preserves user role on update even when role is user', async () => {
      const existing: Partial<User> = {
        id: 'uuid-2',
        email: 'bob@example.com',
        name: 'Bob',
        avatarUrl: null,
        role: 'user',
        lastLoginAt: null,
      };
      userRepo.findOne.mockResolvedValue(existing);

      const result = await service.validateAndUpsertUser({
        email: 'bob@example.com',
        name: 'Robert',
        avatarUrl: null,
      });

      expect(result.role).toBe('user');
    });

    it('always returns the user object', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(0);

      const result = await service.validateAndUpsertUser(profile);

      expect(result).toBeDefined();
      expect(result.email).toBe('alice@example.com');
    });
  });
});
