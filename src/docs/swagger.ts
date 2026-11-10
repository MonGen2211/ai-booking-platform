import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('AI Booking Platform API')
    .setDescription('Backend API for doctors, authentication, appointment booking and operations. Authentication cookie endpoints require an allowed Origin and CSRF token.')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/openapi.json',
    customSiteTitle: 'AI Booking API Docs',
  });
}
