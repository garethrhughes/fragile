import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { User } from '../database/entities/user.entity.js';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    userRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (u: User) => u),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns all users ordered by email', async () => {
      const users = [
        { id: '1', email: 'alice@example.com', name: 'Alice', role: 'admin' },
        { id: '2', email: 'bob@example.com', name: 'Bob', role: 'user' },
      ] as User[];
      userRepo.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(userRepo.find).toHaveBeenCalledWith({ order: { email: 'ASC' } });
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------

  describe('findById', () => {
    it('returns user when found', async () => {
      const user = { id: 'uuid-1', email: 'alice@example.com' } as User;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.findById('uuid-1');

      expect(result).toBe(user);
      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('returns null when not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // updateRole
  // ---------------------------------------------------------------------------

  describe('updateRole', () => {
    it('updates the role and returns the user', async () => {
      const user = { id: 'uuid-1', email: 'alice@example.com', role: 'user' } as User;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.updateRole('uuid-1', 'admin');

      expect(result.role).toBe('admin');
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'uuid-1', role: 'admin' }),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.updateRole('nonexistent', 'admin')).rejects.toThrow(
        NotFoundException,
      );
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });
});
