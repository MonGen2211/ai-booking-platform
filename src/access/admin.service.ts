import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UserRole } from '../generated/prisma/enums.js';

type AccessInput = { role: UserRole; doctorId: string | null };

function parseInput(body: unknown): AccessInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badInput();
  const input = body as Record<string, unknown>;
  if (!['PATIENT', 'DOCTOR', 'ADMIN'].includes(String(input.role))) throw badInput();
  const role = input.role as UserRole;
  if (role === 'DOCTOR' && (typeof input.doctorId !== 'string' || !input.doctorId.trim())) throw badInput();
  if (role !== 'DOCTOR' && input.doctorId != null) throw badInput();
  return { role, doctorId: role === 'DOCTOR' ? String(input.doctorId) : null };
}

function badInput() { return new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid access data' }); }
function conflict(code: string, message: string) { return new ConflictException({ code, message }); }

@Injectable()
export class AdminAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async find(rawEmail: string) {
    if (typeof rawEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) throw badInput();
    const user = await this.prisma.user.findUnique({
      where: { email: rawEmail.trim().toLowerCase() },
      select: { id: true, email: true, role: true, doctorId: true },
    });
    return { items: user ? [user] : [] };
  }

  async change(actorId: string, targetId: string, body: unknown) {
    const input = parseInput(body);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize role changes, including simultaneous attempts to demote the last admins.
        await tx.$queryRaw`SELECT id FROM User ORDER BY id FOR UPDATE`;
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
        if (actor?.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
        const target = await tx.user.findUnique({ where: { id: targetId }, select: { role: true, doctorId: true } });
        if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
        if (input.role === 'DOCTOR') {
          const doctor = await tx.doctor.findUnique({ where: { id: input.doctorId! }, select: { id: true } });
          if (!doctor) throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' });
        }
        if (target.role === 'ADMIN' && input.role !== 'ADMIN') {
          const count = await tx.user.count({ where: { role: 'ADMIN' } });
          if (count <= 1) throw conflict('LAST_ADMIN', 'Cannot remove the last admin');
        }
        if (target.role === input.role && target.doctorId === input.doctorId) {
          return { id: targetId, ...target };
        }
        const updated = await tx.user.update({
          where: { id: targetId }, data: input,
          select: { id: true, role: true, doctorId: true },
        });
        await tx.accessAudit.create({
          data: { actorId, targetId, oldRole: target.role, newRole: input.role,
            oldDoctorId: target.doctorId, newDoctorId: input.doctorId },
        });
        return updated;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw conflict('DOCTOR_ALREADY_LINKED', 'Doctor is already linked to an account');
      }
      throw error;
    }
  }
}
