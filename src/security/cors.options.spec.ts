import { createCorsOptions } from './cors.options.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';

describe('CORS options', () => {
  const originalOrigin = process.env.FRONTEND_ORIGIN;

  afterAll(() => {
    process.env.FRONTEND_ORIGIN = originalOrigin;
  });

  it('allows credentials only for the configured frontend origin and exposes the Access header', () => {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    expect(createCorsOptions()).toEqual({
      origin: expect.any(Function),
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
      exposedHeaders: ['X-Access-Token'],
    });
  });

  it('rejects missing, wildcard, and non-origin frontend configuration', () => {
    process.env.FRONTEND_ORIGIN = '*';
    expect(() => createCorsOptions()).toThrow();
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173/app';
    expect(() => createCorsOptions()).toThrow();
    delete process.env.FRONTEND_ORIGIN;
    expect(() => createCorsOptions()).toThrow();
  });

  it('answers credentialed preflight for the configured origin and omits access for others', async () => {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    const module = await Test.createTestingModule({}).compile();
    const app = module.createNestApplication();
    app.enableCors(createCorsOptions());
    await app.init();
    try {
      const preflight = await request(app.getHttpServer())
        .options('/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-csrf-token')
        .expect(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(preflight.headers['access-control-allow-credentials']).toBe('true');
      expect(preflight.headers['access-control-expose-headers']).toContain('X-Access-Token');

      const untrusted = await request(app.getHttpServer())
        .options('/auth/login')
        .set('Origin', 'http://evil.example')
        .set('Access-Control-Request-Method', 'POST')
        .expect(404);
      expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
