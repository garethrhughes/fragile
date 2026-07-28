import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { AppModule } from './app.module.js';

// Patch express-session's Session.prototype to guard against undefined cookie.
// This crash occurs when the session store returns a session without a cookie
// property (e.g. corrupt row, or request with no valid session) and express-
// session's res.end hook calls session.touch() → session.resetMaxAge().
const SessionProto = (session as unknown as { Session: { prototype: Record<string, unknown> } }).Session?.prototype;
if (SessionProto) {
  const origResetMaxAge = SessionProto['resetMaxAge'] as (() => unknown) | undefined;
  SessionProto['resetMaxAge'] = function (this: { cookie?: { maxAge?: number; originalMaxAge?: number } }) {
    if (!this.cookie) return this;
    if (origResetMaxAge) return origResetMaxAge.call(this);
    return this;
  };
  const origTouch = SessionProto['touch'] as (() => unknown) | undefined;
  SessionProto['touch'] = function (this: { cookie?: unknown; resetMaxAge?: () => unknown }) {
    if (!this.cookie) return this;
    if (origTouch) return origTouch.call(this);
    return this;
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);

  // P2-7: Validate TIMEZONE env var at startup — fail fast on invalid IANA zone.
  const timezone = configService.get<string>('TIMEZONE', 'UTC');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch (e) {
    if (e instanceof RangeError) {
      throw new Error(
        `Invalid TIMEZONE env var "${timezone}". Must be a valid IANA timezone (e.g. "America/New_York", "UTC").`,
      );
    }
    throw e;
  }

  // Session store — PostgreSQL-backed via connect-pg-simple
  const PgSession = connectPgSimple(session);
  const sessionSecret = configService.get<string>('SESSION_SECRET', 'change-me');
  const sessionMaxAge = configService.get<number>('SESSION_MAX_AGE_MS', 604800000); // 7 days

  app.use(
    session({
      store: new PgSession({
        conObject: {
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          user: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_DATABASE', 'fragile'),
        },
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      name: 'fragile.sid',
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: sessionMaxAge,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  app.enableCors({
    origin: configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Fragile API')
    .setDescription(
      'REST API for Fragile — Jira DORA metrics and sprint planning accuracy.',
    )
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
