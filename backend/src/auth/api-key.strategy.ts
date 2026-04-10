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

  validate(apiKey: string): boolean {
    const validKey = this.configService.get<string>('APP_API_KEY');
    if (apiKey === validKey) {
      return true;
    }
    throw new UnauthorizedException('Invalid API key');
  }
}
