import type { Request, Response } from 'express';
import { appendRefreshCookie, clearRefreshCookie, readCookie } from './auth.cookies.js';

describe('Refresh cookie helpers', () => {
  it('sets Secure only for HTTPS requests and keeps the refresh path at root', () => {
    const response = { appendHeader: vi.fn() } as unknown as Response;
    const secureRequest = { secure: true } as Request;
    appendRefreshCookie(response, secureRequest, 'token-value');

    const cookie = vi.mocked(response.appendHeader).mock.calls[0][1] as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  it('clears the root refresh cookie and safely reads the named cookie', () => {
    const response = { appendHeader: vi.fn() } as unknown as Response;
    const request = { secure: false, headers: { cookie: 'first=one; refresh_token=secret%20value' } } as Request;
    expect(readCookie(request, 'refresh_token')).toBe('secret value');
    clearRefreshCookie(request, response);
    expect(vi.mocked(response.appendHeader).mock.calls[0][1]).toContain('Path=/; SameSite=Lax; Max-Age=0');
  });
});
