import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { CredentialsDto } from '../dto/auth.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface IssuedCredentials {
  user: { id: string; email: string; createdAt: Date };
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(credentials: CredentialsDto): Promise<IssuedCredentials> {
    const email = credentials.email.toLowerCase();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const jti = randomUUID();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const passwordHash = await bcrypt.hash(credentials.password, 12);
    const issued = await this.createTokens(userId, sessionId, jti, absoluteExpiresAt);

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: { id: userId, email, passwordHash },
          select: { id: true, email: true, createdAt: true },
        });
        await transaction.authSession.create({
          data: {
            id: sessionId,
            userId,
            currentRefreshJtiHash: hashJti(jti),
            absoluteExpiresAt,
          },
        });
        return createdUser;
      });

      return { user, ...issued };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'An account with this email already exists',
        });
      }
      throw error;
    }
  }

  async login(credentials: CredentialsDto): Promise<IssuedCredentials> {
    const email = credentials.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    });
    const passwordMatches = user
      ? await bcrypt.compare(credentials.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    const sessionId = randomUUID();
    const jti = randomUUID();
    const absoluteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const issued = await this.createTokens(user.id, sessionId, jti, absoluteExpiresAt);

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        currentRefreshJtiHash: hashJti(jti),
        absoluteExpiresAt,
      },
    });

    return {
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      ...issued,
    };
  }

  async rotateRefreshToken(userId: string, sessionId: string, currentJti: string): Promise<IssuedCredentials> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, currentRefreshJtiHash: true, revokedAt: true, absoluteExpiresAt: true },
    });
    const now = new Date();
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt !== null ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'Session is invalid or expired',
      });
    }

    if (session.currentRefreshJtiHash !== hashJti(currentJti)) {
      throw refreshRace();
    }

    const nextJti = randomUUID();
    const issued = await this.createTokens(userId, sessionId, nextJti, session.absoluteExpiresAt);
    const updated = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        userId,
        currentRefreshJtiHash: hashJti(currentJti),
        revokedAt: null,
        absoluteExpiresAt: { gt: now },
      },
      data: { currentRefreshJtiHash: hashJti(nextJti) },
    });
    if (updated.count !== 1) throw refreshRace();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'Session is invalid or expired',
      });
    }
    return { user, ...issued };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'Session is invalid or expired',
      });
    }
    return user;
  }

  async logoutWithTokens(accessToken?: string, refreshToken?: string): Promise<void> {
    const accessSecret = process.env.ACCESS_TOKEN_SECRET;
    if (accessToken && accessSecret) {
      let payload: { sub?: unknown; sid?: unknown; typ?: unknown } | undefined;
      try {
        payload = await this.jwt.verifyAsync(accessToken, { secret: accessSecret });
      } catch {
        payload = undefined;
      }
      if (
        payload?.typ === 'access' &&
        typeof payload.sub === 'string' &&
        typeof payload.sid === 'string'
      ) {
        await this.prisma.authSession.updateMany({
          where: { id: payload.sid, userId: payload.sub, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return;
      }
    }

    const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
    if (!refreshToken || !refreshSecret) return;
    let payload: { sub?: unknown; sid?: unknown; jti?: unknown; typ?: unknown };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: refreshSecret });
    } catch {
      return;
    }
    if (
      payload.typ !== 'refresh' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.jti !== 'string'
    ) return;
    await this.prisma.authSession.updateMany({
      where: {
        id: payload.sid,
        userId: payload.sub,
        currentRefreshJtiHash: hashJti(payload.jti),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  private async createTokens(
    userId: string,
    sessionId: string,
    jti: string,
    expiresAt: Date,
  ): Promise<Pick<IssuedCredentials, 'accessToken' | 'refreshToken'>> {
    const accessSecret = process.env.ACCESS_TOKEN_SECRET;
    const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
    if (!accessSecret || !refreshSecret || accessSecret === refreshSecret) {
      throw new Error('Authentication signing secrets are not configured');
    }

    const refreshTtlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (refreshTtlSeconds <= 0) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'Session is invalid or expired',
      });
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, sid: sessionId, typ: 'access' },
        { secret: accessSecret, expiresIn: '15m' },
      ),
      this.jwt.signAsync(
        { sub: userId, sid: sessionId, jti, typ: 'refresh' },
        { secret: refreshSecret, expiresIn: refreshTtlSeconds },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}

function refreshRace(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'AUTH_REFRESH_RACE',
    message: 'Refresh credential is no longer current',
  });
}

export function hashJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
