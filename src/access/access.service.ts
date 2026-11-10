import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async capabilities(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, doctorId: true },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return {
      ...user,
      canManageAll: user.role === 'ADMIN',
      canManageDoctor: user.role === 'DOCTOR' && !!user.doctorId,
    };
  }

  async requireAdmin(userId: string): Promise<void> {
    const access = await this.capabilities(userId);
    if (access.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
  }

  async requireDoctor(userId: string, doctorId: string): Promise<void> {
    const access = await this.capabilities(userId);
    if (access.role !== 'ADMIN' && (access.role !== 'DOCTOR' || access.doctorId !== doctorId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' });
    }
  }

  async requireAppointment(userId: string, appointmentId: string): Promise<void> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId }, select: { bookerId: true, doctorId: true },
    });
    if (!appointment) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' });
    const access = await this.capabilities(userId);
    if (appointment.bookerId !== userId && access.role !== 'ADMIN' &&
      (access.role !== 'DOCTOR' || access.doctorId !== appointment.doctorId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' });
    }
  }

  async requireOwner(userId: string, appointmentId: string): Promise<void> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, bookerId: userId }, select: { id: true },
    });
    if (!appointment) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' });
  }
}
