import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { OAuth2Client } from 'google-auth-library';
import * as jwt from 'jsonwebtoken';
import { User } from '../database/entities/user.entity.js';

export interface TokenPayload {
  sub: string; // user id
  email: string;
  name: string;
  role: 'user' | 'admin';
  avatarUrl: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;
  private readonly allowedDomain: string;
  private readonly jwtSecret: string;
  private readonly cookieMaxAgeMs: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    this.googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    this.allowedDomain = this.configService.get<string>('GOOGLE_ALLOWED_DOMAIN', '');
    this.jwtSecret = this.configService.get<string>('SESSION_SECRET', '');
    this.cookieMaxAgeMs = this.configService.get<number>('SESSION_MAX_AGE_MS', 604800000);
    this.googleClient = new OAuth2Client(this.googleClientId);

    // Fail closed: these are the only access controls now that the WAF is
    // removed (ADR 0068). A missing domain would let ANY Google account in;
    // a missing/default secret would let anyone forge an admin JWT.
    if (!this.allowedDomain) {
      throw new Error(
        'GOOGLE_ALLOWED_DOMAIN must be set — it is the sole domain restriction for login. Refusing to start.',
      );
    }
    if (!this.jwtSecret || this.jwtSecret === 'change-me') {
      throw new Error(
        'SESSION_SECRET must be set to a strong, non-default value (used to sign session JWTs). Refusing to start.',
      );
    }
    if (!this.googleClientId) {
      throw new Error('GOOGLE_CLIENT_ID must be set. Refusing to start.');
    }
  }

  /**
   * Verify a Google ID token, check domain, upsert the user, and return
   * the user + a signed JWT cookie value.
   */
  async verifyGoogleToken(idToken: string): Promise<{ user: User; token: string }> {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: this.googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new Error('Invalid token payload');

    const { email, name, picture, hd } = payload;
    if (!email) throw new Error('Token missing email');

    // Domain restriction — fail closed. allowedDomain is guaranteed non-empty
    // by the constructor, so a token with no/other hd is always rejected.
    if (hd !== this.allowedDomain) {
      throw new Error(`Domain '${hd ?? '(none)'}' is not allowed. Expected '${this.allowedDomain}'.`);
    }

    const user = await this.validateAndUpsertUser({
      email,
      name: name ?? email.split('@')[0],
      avatarUrl: picture ?? null,
    });

    const token = this.signToken(user);
    return { user, token };
  }

  /**
   * Find or create user by email. First user becomes admin if no admin exists.
   */
  async validateAndUpsertUser(profile: {
    email: string;
    name: string;
    avatarUrl: string | null;
  }): Promise<User> {
    let user = await this.userRepo.findOne({ where: { email: profile.email } });

    if (user) {
      user.name = profile.name;
      user.avatarUrl = profile.avatarUrl;
      user.lastLoginAt = new Date();
      return this.userRepo.save(user);
    }

    // New user — check if any admin exists
    const adminCount = await this.userRepo.count({ where: { role: 'admin' } });
    const role = adminCount === 0 ? 'admin' : 'user';

    if (role === 'admin') {
      this.logger.log(`First user login — auto-promoting ${profile.email} to admin`);
    }

    user = this.userRepo.create({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      role,
      lastLoginAt: new Date(),
    });

    return this.userRepo.save(user);
  }

  /**
   * Sign a JWT with user identity + role.
   */
  signToken(user: User): string {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'user' | 'admin',
      avatarUrl: user.avatarUrl ?? null,
    };
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: Math.floor(this.cookieMaxAgeMs / 1000),
    });
  }

  /**
   * Verify and decode a JWT token. Returns null if invalid/expired.
   */
  verifyToken(token: string): TokenPayload | null {
    try {
      return jwt.verify(token, this.jwtSecret) as TokenPayload;
    } catch {
      return null;
    }
  }

  get cookieMaxAge(): number {
    return this.cookieMaxAgeMs;
  }
}
