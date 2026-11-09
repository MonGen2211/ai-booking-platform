import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../services/auth.service.js';
import { CsrfService } from '../security/csrf.service.js';
import type { AuthenticatedRequest } from '../common/auth.types.js';

describe('AuthGuard', () => {
  const request = { headers: { authorization: 'Bearer access-token' } } as AuthenticatedRequest;
  const response = { setHeader: vi.fn(), appendHeader: vi.fn() };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-signing-secret';
    request.headers.authorization = 'Bearer access-token';
    request.headers.cookie = undefined;
    response.setHeader.mockClear();
    response.appendHeader.mockClear();
  });

  it('accepts a valid access token and active database session', async () => {
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', sid: 'session-1', typ: 'access' }),
    };
    const prisma = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user-1',
          revokedAt: null,
          absoluteExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const guard = new AuthGuard(jwt as unknown as JwtService, prisma as unknown as PrismaService, {} as AuthService, {} as CsrfService);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual({ userId: 'user-1', sessionId: 'session-1' });
  });

  it.each(['missing access token', 'expired access token'])(
    'automatically refreshes a protected request with a valid refresh cookie when access is %s',
    async (accessState) => {
      const expired = Object.assign(new Error('expired'), { name: 'TokenExpiredError' });
      const verifyAsync = vi.fn();
      if (accessState === 'expired access token') {
        verifyAsync.mockRejectedValueOnce(expired);
      }
      verifyAsync.mockResolvedValueOnce({
        sub: 'user-1',
        sid: 'session-1',
        jti: 'jti-1',
        typ: 'refresh',
      });
      const jwt = { verifyAsync };
      request.headers.authorization = undefined;
      request.headers.cookie = 'refresh_token=refresh-token';
      if (accessState === 'expired access token') request.headers.authorization = 'Bearer expired-access';
      const issued = {
        accessToken: 'next-access',
        refreshToken: 'next-refresh',
      };
      const authService = { rotateRefreshToken: vi.fn().mockResolvedValue(issued) };
      const prisma = {};
      const guard = new AuthGuard(
        jwt as unknown as JwtService,
        prisma as PrismaService,
        authService as unknown as AuthService,
        { validate: vi.fn() } as unknown as CsrfService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(response.setHeader).toHaveBeenCalledWith('X-Access-Token', 'next-access');
      expect(response.appendHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining('refresh_token=next-refresh'),
      );
      expect(request.auth).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    },
  );

  it.each([
    ['missing bearer token', undefined, null],
    ['invalid signature or expired token', Object.assign(new Error('invalid token'), { name: 'JsonWebTokenError' }), null],
    ['wrong token type', { sub: 'user-1', sid: 'session-1', typ: 'refresh' }, null],
    ['revoked session', { sub: 'user-1', sid: 'session-1', typ: 'access' }, { revokedAt: new Date() }],
    ['expired session', { sub: 'user-1', sid: 'session-1', typ: 'access' }, { absoluteExpiresAt: new Date(0) }],
  ])('rejects %s', async (_label, jwtResult, sessionChange) => {
    const jwt = {
      verifyAsync: vi.fn().mockImplementation(async () => {
        if (jwtResult instanceof Error) throw jwtResult;
        return jwtResult;
      }),
    };
    if (_label === 'missing bearer token') request.headers.authorization = undefined;
    else request.headers.authorization = 'Bearer access-token';
    const session = {
      userId: 'user-1',
      revokedAt: null,
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      ...sessionChange,
    };
    const prisma = { authSession: { findUnique: vi.fn().mockResolvedValue(session) } };
    const guard = new AuthGuard(jwt as unknown as JwtService, prisma as unknown as PrismaService, {} as AuthService, {} as CsrfService);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not convert a database failure into an authentication 401', async () => {
    request.headers.authorization = 'Bearer access-token';
    const databaseError = new Error('database unavailable');
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', sid: 'session-1', typ: 'access' }),
    };
    const prisma = { authSession: { findUnique: vi.fn().mockRejectedValue(databaseError) } };
    const authService = { rotateRefreshToken: vi.fn() };
    const guard = new AuthGuard(
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      {} as CsrfService,
    );

    await expect(guard.canActivate(context)).rejects.toBe(databaseError);
    expect(authService.rotateRefreshToken).not.toHaveBeenCalled();
  });
});
