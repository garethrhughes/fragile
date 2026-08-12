import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnapshotComputeModule } from '../snapshot/snapshot-compute.module.js';

/**
 * SnapshotWorkerModule
 *
 * The root module the prod snapshot Lambda bootstraps (proposal 0084). It wires
 * only what snapshot computation needs — a TypeORM connection + the single
 * SnapshotComputeModule — and deliberately omits HTTP controllers, guards,
 * scheduler, and throttler that the full AppModule pulls in.
 *
 * The DB password is resolved from Secrets Manager by the handler before boot
 * and placed on the environment as DB_PASSWORD, so the standard ConfigService
 * factory (identical to AppModule's) reads it. This is the sanctioned Lambda
 * entrypoint for process.env use.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_DATABASE', 'fragile'),
        ssl: config.get<string>('DB_SSL') === 'true'
          ? { rejectUnauthorized: false }
          : false,
        // Glob matches the compiled entities in the Lambda bundle (dist).
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        // The Lambda never runs migrations.
        migrationsRun: false,
        synchronize: false,
      }),
    }),
    SnapshotComputeModule,
  ],
})
export class SnapshotWorkerModule {}
