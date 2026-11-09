import type { Request, Response } from 'express';

export function appendRefreshCookie(
  response: Response,
  request: Request,
  token: string,
): void {
  const parts = [
    `refresh_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=604800',
  ];
  if (request.secure || process.env.NODE_ENV === 'production') parts.push('Secure');
  response.appendHeader('Set-Cookie', parts.join('; '));
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function clearRefreshCookie(request: Request, response: Response): void {
  const parts = ['refresh_token=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (request.secure || process.env.NODE_ENV === 'production') parts.push('Secure');
  response.appendHeader('Set-Cookie', parts.join('; '));
}
