import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async validateAndUpsertUser(profile: {
    email: string;
    name: string;
    avatarUrl: string | null;
  }): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { email: profile.email },
    });

    if (existing) {
      existing.name = profile.name;
      existing.avatarUrl = profile.avatarUrl;
      existing.lastLoginAt = new Date();
      this.logger.log(`User logged in: ${profile.email}`);
      return this.userRepository.save(existing);
    }

    const adminCount = await this.userRepository.count({
      where: { role: 'admin' },
    });

    const user = this.userRepository.create({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      role: adminCount === 0 ? 'admin' : 'user',
      lastLoginAt: new Date(),
    });

    this.logger.log(
      `New user created: ${profile.email} (role: ${user.role})`,
    );
    return this.userRepository.save(user);
  }
}
