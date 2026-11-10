import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureSwagger } from '../src/docs/swagger.js';

describe('Swagger documentation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureSwagger(app);
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('serves UI and documents the actual API routes with request bodies and security', async () => {
    const ui = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(ui.text).toContain('swagger-ui');

    const response = await request(app.getHttpServer()).get('/api/openapi.json').expect(200);
    const document = response.body as { paths: Record<string, Record<string, any>>;
      components: { securitySchemes: Record<string, unknown> } };
    const operations = Object.values(document.paths).flatMap((path) =>
      Object.entries(path).filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)));
    expect(operations.length).toBe(35);
    expect(document.paths['/appointments'].post.requestBody.content['application/json'].schema.properties.slotId).toBeDefined();
    expect(document.paths['/me/attachments'].post.requestBody.content['multipart/form-data'].schema.properties.file.format).toBe('binary');
    expect(document.paths['/operations/appointments/{id}/confirm'].post.security).toEqual([{ 'access-token': [] }]);
    expect(document.components.securitySchemes['access-token']).toBeDefined();
  });
});
