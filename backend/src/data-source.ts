import { DataSource } from 'typeorm';
import 'dotenv/config';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE ?? 'ai_starter',
  entities: [
    'dist/**/*.entity.js',
    'dist/database/entities/*.entity.js',
  ],
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
});
