import type { Request, Response } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { CsrfService } from './csrf.service.js';

describe('CsrfService', () => {
  const service = new CsrfService();
  const response = { appendHeader: vi.fn(), setHeader: vi.fn() } as unknown as Response;

  beforeEach(() => {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    response.appendHeader = vi.fn();
    response.setHeader = vi.fn();
  });

  it('issues a random CSRF cookie and a matching non-JWT token in the response body', () => {
    const request = { headers: { origin: 'http://localhost:5173' }, secure: false } as Request;
    const result = service.bootstrap(request, response);
    const cookie = vi.mocked(response.appendHeader).mock.calls[0][1] as string;

    expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain(`csrf_token=${result.csrfToken}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('accepts matching cookie, header, and exact allowed Origin', () => {
    const token = 'random-csrf-value';
    const request = {
      headers: {
        origin: 'http://localhost:5173',
        cookie: `csrf_token=${token}`,
        'x-csrf-token': token,
      },
    } as Request;
    expect(() => service.validate(request)).not.toThrow();
  });

  it.each([
    ['missing cookie', { origin: 'http://localhost:5173', 'x-csrf-token': 'token' }],
    ['missing header', { origin: 'http://localhost:5173', cookie: 'csrf_token=token' }],
    ['mismatched values', { origin: 'http://localhost:5173', cookie: 'csrf_token=one', 'x-csrf-token': 'two' }],
    ['untrusted Origin', { origin: 'http://evil.example', cookie: 'csrf_token=token', 'x-csrf-token': 'token' }],
  ])('rejects %s', (_case, headers) => {
    expect(() => service.validate({ headers } as Request)).toThrow(ForbiddenException);
  });
});
