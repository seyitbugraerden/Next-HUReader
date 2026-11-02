import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';

const require = createRequire(import.meta.url);
let application;

async function createApplication() {
  const app = await NestFactory.create(AppModule);
  app.useStaticAssets(
    join(dirname(require.resolve('exceljs/package.json')), 'dist'),
    { prefix: '/vendor/' },
  );
  await app.init();
  return app.getHttpAdapter().getInstance();
}

export default async function handler(request, response) {
  application ??= createApplication().catch((error) => {
    application = undefined;
    console.error('Application startup failed:', error);
    throw error;
  });
  const server = await application;
  return server(request, response);
}
