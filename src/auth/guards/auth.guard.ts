import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../services/auth.service.js';
import { CsrfService } from '../security/csrf.service.js';
import { appendRefreshCookie, readCookie } from '../security/auth.cookies.js';
import { AuthenticatedRequest } from '../common/auth.types.js';

interface AccessPayload {
  sub?: unknown;
  sid?: unknown;
  typ?: unknown;
}

interface RefreshPayload {
  sub?: unknown;
  sid?: unknown;
  jti?: unknown;
  typ?: unknown;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly csrfService: CsrfService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const authorization = request.headers.authorization;
    const token = bearerToken(authorization);

    if (authorization && !token) throw unauthorized();
    if (token) {
      let payload: AccessPayload | undefined;
      try {
        payload = await this.verifyAccess(token);
      } catch (error) {
        if (isExpiredToken(error)) {
          payload = undefined;
        } else if (error instanceof UnauthorizedException) {
          throw error;
        } else if (isInvalidJwt(error)) {
          throw unauthorized();
        } else {
          throw error;
        }
      }

      if (payload) {
        const session = await this.prisma.authSession.findUnique({
          where: { id: payload.sid as string },
          select: { userId: true, revokedAt: true, absoluteExpiresAt: true },
        });
        if (
          !session ||
          session.userId !== payload.sub ||
          session.revokedAt !== null ||
          session.absoluteExpiresAt.getTime() <= Date.now()
        ) {
          throw unauthorized('AUTH_SESSION_INVALID', 'Session is invalid or expired');
        }
        request.auth = { userId: payload.sub as string, sessionId: payload.sid as string };
        return true;
      }
    }

    const refreshToken = readCookie(request as Request, 'refresh_token');
    if (!refreshToken) throw unauthorized();
    this.csrfService.validate(request as Request);
    const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
    if (!refreshSecret) throw new Error('Authentication signing secrets are not configured');

    let refresh: RefreshPayload;
    try {
      refresh = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, { secret: refreshSecret });
    } catch {
      throw unauthorized('AUTH_SESSION_INVALID', 'Session is invalid or expired');
    }
    if (
      refresh.typ !== 'refresh' ||
      typeof refresh.sub !== 'string' ||
      typeof refresh.sid !== 'string' ||
      typeof refresh.jti !== 'string'
    ) {
      throw unauthorized('AUTH_SESSION_INVALID', 'Session is invalid or expired');
    }

    const issued = await this.authService.rotateRefreshToken(
      refresh.sub,
      refresh.sid,
      refresh.jti,
    );
    response.setHeader('X-Access-Token', issued.accessToken);
    appendRefreshCookie(response, request, issued.refreshToken);
    request.auth = { userId: refresh.sub, sessionId: refresh.sid };
    return true;
  }

  private async verifyAccess(token: string): Promise<AccessPayload> {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) throw new Error('Authentication signing secrets are not configured');
    const payload = await this.jwt.verifyAsync<AccessPayload>(token, { secret });
    if (
      payload.typ !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw unauthorized();
    }
    return payload;
  }
}

function bearerToken(value: string | undefined): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isExpiredToken(error: unknown): boolean {
  return error instanceof Error && error.name === 'TokenExpiredError';
}

function isInvalidJwt(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError')
  );
}

function unauthorized(
  code = 'AUTH_REQUIRED',
  message = 'Authentication is required',
): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}
