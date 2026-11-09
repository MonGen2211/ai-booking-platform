import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createCorsOptions } from '../src/security/cors.options.js';

describe('Authentication (e2e, local MySQL)', () => {
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  const testEmail = `auth-e2e-${randomUUID()}@example.test`;
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.enableCors(createCorsOptions());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (prisma) {
      const user = await prisma.user.findUnique({ where: { email: testEmail }, select: { id: true } });
      if (user) {
        await prisma.authSession.deleteMany({ where: { userId: user.id } });
        await prisma.user.deleteMany({ where: { id: user.id, email: testEmail } });
      }
    }
    await app?.close();
  });

  it('registers, logs in, auto-refreshes atomically, logs out one session, and keeps another active', async () => {
    const server = app.getHttpServer();
    const csrfBootstrap = await request(server)
      .get('/auth/csrf')
      .set('Origin', frontendOrigin)
      .expect(200);
    const csrfToken = csrfBootstrap.body.csrfToken as string;
    const csrfCookie = cookiePair(csrfBootstrap.headers['set-cookie'], 'csrf_token');
    const csrfHeaders = {
      Origin: frontendOrigin,
      Cookie: csrfCookie,
      'X-CSRF-Token': csrfToken,
    };

    const registered = await request(server)
      .post('/auth/register')
      .set(csrfHeaders)
      .send({ email: testEmail, password: 'correct-password' })
      .expect(201);
    expect(registered.headers['x-access-token']).toBeTruthy();
    const registrationAccess = registered.headers['x-access-token'] as string;
    const registrationRefresh = cookiePair(registered.headers['set-cookie'], 'refresh_token');
    expect(registered.headers['set-cookie'][0]).toContain('HttpOnly');

    const duplicate = await request(server)
      .post('/auth/register')
      .set(csrfHeaders)
      .send({ email: testEmail.toUpperCase(), password: 'correct-password' })
      .expect(409);
    expect(duplicate.body.code).toBe('EMAIL_ALREADY_EXISTS');

    const wrongPassword = await request(server)
      .post('/auth/login')
      .set(csrfHeaders)
      .send({ email: testEmail, password: 'incorrect-password' })
      .expect(401);
    const unknownEmail = await request(server)
      .post('/auth/login')
      .set(csrfHeaders)
      .send({ email: `missing-${testEmail}`, password: 'incorrect-password' })
      .expect(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);

    await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${registrationAccess}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: registered.body.id, email: testEmail });
      });

    const login = await request(server)
      .post('/auth/login')
      .set(csrfHeaders)
      .send({ email: testEmail.toUpperCase(), password: 'correct-password' })
      .expect(200);
    const loginAccess = login.headers['x-access-token'] as string;
    const oldRefresh = cookiePair(login.headers['set-cookie'], 'refresh_token');
    const refreshPayload = jwt.decode(cookieValue(oldRefresh)) as { sid: string };
    const expiredAccess = await jwt.signAsync(
      { sub: login.body.id, sid: refreshPayload.sid, typ: 'access' },
      { secret: process.env.ACCESS_TOKEN_SECRET, expiresIn: -1 },
    );
    const refreshRequestHeaders = {
      ...csrfHeaders,
      Cookie: `${csrfCookie}; ${oldRefresh}`,
      Authorization: `Bearer ${expiredAccess}`,
    };

    const concurrent = await Promise.all([
      request(server).get('/auth/me').set(refreshRequestHeaders),
      request(server).get('/auth/me').set(refreshRequestHeaders),
    ]);
    const successfulRefreshes = concurrent.filter((response) => response.status === 200);
    const raceLosers = concurrent.filter((response) => response.status === 401);
    expect(successfulRefreshes).toHaveLength(1);
    expect(raceLosers).toHaveLength(1);
    expect(raceLosers[0].body).toMatchObject({ code: 'AUTH_REFRESH_RACE' });

    const winner = successfulRefreshes[0];
    const rotatedAccess = winner.headers['x-access-token'] as string;
    const rotatedRefresh = cookiePair(winner.headers['set-cookie'], 'refresh_token');
    expect(rotatedAccess).toBeTruthy();
    expect(rotatedRefresh).toBeTruthy();

    const lostResponseRetry = await request(server).get('/auth/me').set(refreshRequestHeaders);
    expect(lostResponseRetry.status).toBe(401);
    expect(lostResponseRetry.body).toMatchObject({ code: 'AUTH_REFRESH_RACE' });
    expect(lostResponseRetry.headers['x-access-token']).toBeUndefined();
    expect(lostResponseRetry.headers['set-cookie']).toBeUndefined();
    await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${rotatedAccess}`)
      .expect(200);

    await request(server)
      .post('/auth/logout')
      .set({ ...csrfHeaders, Cookie: `${csrfCookie}; ${rotatedRefresh}`, Authorization: `Bearer ${rotatedAccess}` })
      .expect(204);
    await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${rotatedAccess}`)
      .expect(401);
    await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${registrationAccess}`)
      .expect(200);
    expect(registrationRefresh).toContain('refresh_token=');
    expect(loginAccess).toBeTruthy();
  });
});

function cookiePair(setCookie: string[] | undefined, name: string): string {
  const cookie = setCookie?.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Expected ${name} cookie`);
  return cookie.split(';', 1)[0];
}

function cookieValue(cookiePairValue: string): string {
  return decodeURIComponent(cookiePairValue.slice(cookiePairValue.indexOf('=') + 1));
}
