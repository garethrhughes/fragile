import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

interface GoogleProfile {
  emails: Array<{ value: string; verified: boolean }>;
  displayName: string;
  photos: Array<{ value: string }>;
  _json: { hd?: string };
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly allowedDomain: string;

  constructor(private readonly configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET', '');
    const callbackURL = configService.get<string>(
      'GOOGLE_CALLBACK_URL',
      'http://localhost:3001/api/auth/google/callback',
    );

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });

    this.allowedDomain = configService.get<string>(
      'GOOGLE_ALLOWED_DOMAIN',
      '',
    );
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ): void {
    const hostedDomain = profile._json.hd;

    if (this.allowedDomain && hostedDomain !== this.allowedDomain) {
      done(
        new UnauthorizedException(
          `Only ${this.allowedDomain} accounts are allowed`,
        ),
        undefined,
      );
      return;
    }

    const email = profile.emails[0]?.value;
    if (!email) {
      done(new UnauthorizedException('No email found in Google profile'), undefined);
      return;
    }

    const user = {
      email,
      name: profile.displayName,
      avatarUrl: profile.photos[0]?.value ?? null,
      domain: hostedDomain,
    };

    done(null, user);
  }
}
