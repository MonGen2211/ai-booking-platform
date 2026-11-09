import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createCorsOptions } from './security/cors.options.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(createCorsOptions());
  await app.listen(3000);
}
await bootstrap();
