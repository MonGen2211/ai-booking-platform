import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createCorsOptions } from './security/cors.options.js';
import { bookingPolicy } from './appointments/policy.js';
import { configureSwagger } from './docs/swagger.js';

async function bootstrap() {
  bookingPolicy();
  const app = await NestFactory.create(AppModule);
  app.enableCors(createCorsOptions());
  configureSwagger(app);
  await app.listen(3000);
}
await bootstrap();
