import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
