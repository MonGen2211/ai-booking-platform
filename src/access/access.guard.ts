import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { AccessService } from './access.service.js';

export type AccessRule = 'admin' | 'doctor' | 'appointment' | 'owner';
export const ACCESS_RULE = 'appointment-access-rule';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule>(ACCESS_RULE, [
      context.getHandler(), context.getClass(),
    ]);
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.auth!.userId;
    const targetId = String(request.params.id);
    if (rule === 'admin') await this.access.requireAdmin(userId);
    if (rule === 'doctor') await this.access.requireDoctor(userId, targetId);
    if (rule === 'appointment') await this.access.requireAppointment(userId, targetId);
    if (rule === 'owner') await this.access.requireOwner(userId, targetId);
    return true;
  }
}
