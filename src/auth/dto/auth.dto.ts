import { AuthException } from '../common/auth.errors.js';
import { HttpStatus } from '@nestjs/common';

export interface CredentialsDto {
  email: string;
  password: string;
}

function invalidBody(): never {
  throw new AuthException(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'Request data is invalid',
  );
}

export function parseCredentials(body: unknown): CredentialsDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalidBody();

  const { email, password } = body as Record<string, unknown>;
  if (
    typeof email !== 'string' ||
    email.trim().length === 0 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== 'string' ||
    password.length < 8
  ) {
    return invalidBody();
  }

  return { email: email.trim().toLowerCase(), password };
}
