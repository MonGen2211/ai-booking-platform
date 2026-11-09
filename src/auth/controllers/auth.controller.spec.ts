import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import { AuthService } from '../services/auth.service.js';
import { AuthGuard } from '../guards/auth.guard.js';
import { CsrfService } from '../security/csrf.service.js';

describe('AuthController response contract', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const authService = {
      register: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      login: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'a@example.com' }),
      logoutWithTokens: vi.fn().mockResolvedValue(undefined),
    };
    const builder = Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: CsrfService, useValue: { bootstrap: () => ({ csrfToken: 'csrf-token' }), validate: vi.fn() } },
      ],
    }).overrideGuard(AuthGuard).useValue({
      canActivate: (context: { switchToHttp: () => { getRequest: () => { auth?: unknown } } }) => {
        context.switchToHttp().getRequest().auth = { userId: 'user-1', sessionId: 'session-1' };
        return true;
      },
    });
    const module = await builder.compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('returns the declared success statuses', async () => {
    const server = app.getHttpServer();
    await request(server).get('/auth/csrf').set('Origin', 'http://localhost:5173').expect(200);
    const credentials = { email: 'a@example.com', password: 'password8' };

    const register = await request(server).post('/auth/register').send(credentials).expect(201);
    expect(register.headers['x-access-token']).toBe('access-token');
    expect(register.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(register.headers['set-cookie'][0]).toContain('Path=/');
    expect(register.headers['set-cookie'][0]).toContain('SameSite=Lax');
    const login = await request(server).post('/auth/login').send(credentials).expect(200);
    expect(login.headers['x-access-token']).toBe('access-token');
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    await request(server).get('/auth/me').expect(200);
    const logout = await request(server).post('/auth/logout').expect(204);
    expect(logout.headers['set-cookie'][0]).toContain('Max-Age=0');
  });

  it('returns a stable validation error for invalid credentials payloads', async () => {
    const server = app.getHttpServer();
    for (const path of ['/auth/register', '/auth/login']) {
      const response = await request(server).post(path).send({ email: 'bad', password: 'short' }).expect(400);
      expect(response.body).toEqual({ code: 'VALIDATION_ERROR', message: 'Request data is invalid' });
    }
  });

  it('rejects state-changing requests without valid Origin and CSRF before calling the service', async () => {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    const register = vi.fn();
    const builder = Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { register, login: vi.fn(), logoutWithTokens: vi.fn() } },
        { provide: CsrfService, useClass: CsrfService },
      ],
    }).overrideGuard(AuthGuard).useValue({ canActivate: () => true });
    const module = await builder.compile();
    const guardedApp = module.createNestApplication();
    await guardedApp.init();
    try {
      const response = await request(guardedApp.getHttpServer())
        .post('/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'a@example.com', password: 'password8' })
        .expect(403);
      expect(response.body).toEqual({ code: 'CSRF_INVALID', message: 'CSRF token is invalid' });
      expect(register).not.toHaveBeenCalled();

      await request(guardedApp.getHttpServer())
        .post('/auth/register')
        .set('Origin', 'http://evil.example')
        .set('Cookie', 'csrf_token=token')
        .set('X-CSRF-Token', 'token')
        .send({ email: 'a@example.com', password: 'password8' })
        .expect(403);
      expect(register).not.toHaveBeenCalled();
    } finally {
      await guardedApp.close();
    }
  });
});
