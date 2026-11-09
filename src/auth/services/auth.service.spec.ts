import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService, hashJti } from './auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService registration', () => {
  const originalAccessSecret = process.env.ACCESS_TOKEN_SECRET;
  const originalRefreshSecret = process.env.REFRESH_TOKEN_SECRET;

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-signing-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-signing-secret';
  });

  afterAll(() => {
    process.env.ACCESS_TOKEN_SECRET = originalAccessSecret;
    process.env.REFRESH_TOKEN_SECRET = originalRefreshSecret;
  });

  it('normalizes email, hashes password, and creates user and session in one transaction', async () => {
    const user = { id: 'user-1', email: 'person@example.com', createdAt: new Date() };
    const transaction = {
      user: { create: vi.fn().mockResolvedValue(user) },
      authSession: { create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const jwt = {
      signAsync: vi.fn(async (payload: { typ: string }) => `${payload.typ}-token`),
    };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    const issued = await service.register({ email: 'Person@Example.com', password: 'password8' });

    expect(issued.user).toEqual(user);
    expect(issued.accessToken).toBe('access-token');
    expect(issued.refreshToken).toBe('refresh-token');
    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'person@example.com' }) }),
    );
    const userData = transaction.user.create.mock.calls[0][0].data;
    expect(await bcrypt.compare('password8', userData.passwordHash)).toBe(true);
    expect(userData.passwordHash).not.toBe('password8');
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: userData.id,
        currentRefreshJtiHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        absoluteExpiresAt: expect.any(Date),
      }),
    });
  });

  it('maps a unique email race to HTTP 409', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
    };
    const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    await expect(
      service.register({ email: 'person@example.com', password: 'password8' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AuthService login', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('password8', 4);
  });

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-signing-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-signing-secret';
  });

  it('creates a separate session and returns the signed tokens for valid credentials', async () => {
    const user = {
      id: 'user-1',
      email: 'person@example.com',
      passwordHash,
      createdAt: new Date(),
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      authSession: { create: vi.fn().mockResolvedValue({ id: 'session-2' }) },
    };
    const jwt = {
      signAsync: vi.fn(async (payload: { typ: string }) => `${payload.typ}-token`),
    };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    const issued = await service.login({ email: 'PERSON@example.com', password: 'password8' });

    expect(issued.user.id).toBe(user.id);
    expect(issued.accessToken).toBe('access-token');
    expect(issued.refreshToken).toBe('refresh-token');
    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: user.id,
        currentRefreshJtiHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        absoluteExpiresAt: expect.any(Date),
      }),
    });
  });

  it('uses the same generic 401 response for unknown email and wrong password', async () => {
    const makeService = (user: object | null) => {
      const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
      return new AuthService(prisma as unknown as PrismaService, {} as JwtService);
    };
    const requestCredentials = { email: 'person@example.com', password: 'wrongpass' };
    const outcomes = await Promise.all(
      [null, { id: 'user-1', passwordHash, email: 'person@example.com', createdAt: new Date() }].map(
        async (user) => {
          try {
            await makeService(user).login(requestCredentials);
            throw new Error('expected login rejection');
          } catch (error) {
            expect(error).toBeInstanceOf(UnauthorizedException);
            return (error as UnauthorizedException).getResponse();
          }
        },
      ),
    );
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
  });
});

describe('AuthService refresh rotation', () => {
  const activeSession = {
    userId: 'user-1',
    currentRefreshJtiHash: hashJti('old-jti'),
    revokedAt: null,
    absoluteExpiresAt: new Date(Date.now() + 60_000),
  };
  const user = { id: 'user-1', email: 'person@example.com', createdAt: new Date() };

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-signing-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-signing-secret';
  });

  it('uses a conditional current-JTI update and preserves the fixed session expiry', async () => {
    const prisma = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue(activeSession),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
    };
    const jwt = { signAsync: vi.fn().mockResolvedValue('successor-token') };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    await expect(service.rotateRefreshToken('user-1', 'session-1', 'old-jti')).resolves.toMatchObject({
      user,
      accessToken: 'successor-token',
      refreshToken: 'successor-token',
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'session-1',
        userId: 'user-1',
        currentRefreshJtiHash: hashJti('old-jti'),
        revokedAt: null,
        absoluteExpiresAt: { gt: expect.any(Date) },
      }),
      data: { currentRefreshJtiHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ typ: 'refresh', sid: 'session-1' }),
      expect.objectContaining({ expiresIn: expect.any(Number) }),
    );
  });

  it('returns AUTH_REFRESH_RACE without revoking the session when the conditional update loses', async () => {
    const prisma = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue(activeSession),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
    };
    const jwt = { signAsync: vi.fn().mockResolvedValue('successor-token') };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    try {
      await service.rotateRefreshToken('user-1', 'session-1', 'old-jti');
      throw new Error('expected refresh race');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({ code: 'AUTH_REFRESH_RACE' });
    }
  });

  it('allows only one of two concurrent rotations to update the same JTI', async () => {
    let currentHash = hashJti('old-jti');
    const prisma = {
      authSession: {
        findUnique: vi.fn(async () => ({ ...activeSession, currentRefreshJtiHash: currentHash })),
        updateMany: vi.fn(async (args: { where: { currentRefreshJtiHash: string }; data: { currentRefreshJtiHash: string } }) => {
          if (args.where.currentRefreshJtiHash !== currentHash) return { count: 0 };
          currentHash = args.data.currentRefreshJtiHash;
          return { count: 1 };
        }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
    };
    const jwt = { signAsync: vi.fn(async () => `token-${Math.random()}`) };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    const outcomes = await Promise.allSettled([
      service.rotateRefreshToken('user-1', 'session-1', 'old-jti'),
      service.rotateRefreshToken('user-1', 'session-1', 'old-jti'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(loser?.status === 'rejected' && loser.reason.getResponse()).toMatchObject({
      code: 'AUTH_REFRESH_RACE',
    });
  });
});

describe('AuthService logout', () => {
  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-signing-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-signing-secret';
  });

  it('revokes only the session identified by the valid access token', async () => {
    const prisma = { authSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', sid: 'session-1', typ: 'access' }),
    };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    await service.logoutWithTokens('access-token');

    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does nothing for missing or invalid tokens and remains idempotent', async () => {
    const prisma = { authSession: { updateMany: vi.fn() } };
    const jwt = { verifyAsync: vi.fn().mockRejectedValue(new Error('invalid token')) };
    const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

    await expect(service.logoutWithTokens()).resolves.toBeUndefined();
    await expect(service.logoutWithTokens('invalid-access', 'invalid-refresh')).resolves.toBeUndefined();
    expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
  });
});
