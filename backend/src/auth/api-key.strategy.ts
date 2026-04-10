import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { HeaderAPIKeyStrategy } from 'passport-headerapikey';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(
  HeaderAPIKeyStrategy,
  'api-key',
) {
  constructor(private readonly configService: ConfigService) {
    super({ header: 'x-api-key', prefix: '' }, false);
  }

  validate(
    apiKey: string,
    done: (error: Error | null, data: unknown) => void,
  ): void {
    const validKey = this.configService.get<string>('APP_API_KEY');
    if (apiKey === validKey) {
      return done(null, true);
    }
    return done(new UnauthorizedException('Invalid API key'), null);
  }
}
