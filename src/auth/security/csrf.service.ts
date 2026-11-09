import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { readCookie } from './auth.cookies.js';

@Injectable()
export class CsrfService {
  bootstrap(request: Request, response: Response): { csrfToken: string } {
    this.validateOrigin(request);
    const csrfToken = randomBytes(32).toString('base64url');
    const cookie = [
      `csrf_token=${csrfToken}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      'Max-Age=3600',
    ];
    if (request.secure || process.env.NODE_ENV === 'production') cookie.push('Secure');
    response.appendHeader('Set-Cookie', cookie.join('; '));
    response.setHeader('Cache-Control', 'no-store');
    return { csrfToken };
  }

  validate(request: Request): void {
    this.validateOrigin(request);
    const cookieToken = readCookie(request, 'csrf_token');
    const headerToken = request.headers['x-csrf-token'];
    if (typeof headerToken !== 'string' || !cookieToken) {
      throw csrfInvalid();
    }

    const cookieDigest = createHash('sha256').update(cookieToken).digest();
    const headerDigest = createHash('sha256').update(headerToken).digest();
    if (!timingSafeEqual(cookieDigest, headerDigest)) throw csrfInvalid();
  }

  private validateOrigin(request: Request): void {
    const allowedOrigin = process.env.FRONTEND_ORIGIN;
    const origin = request.headers.origin;
    if (!allowedOrigin || typeof origin !== 'string' || origin !== allowedOrigin) {
      throw new ForbiddenException({
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed',
      });
    }
  }
}

function csrfInvalid(): ForbiddenException {
  return new ForbiddenException({ code: 'CSRF_INVALID', message: 'CSRF token is invalid' });
}
