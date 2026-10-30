import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  app.useStaticAssets(join(import.meta.dirname, '..', 'public'));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
