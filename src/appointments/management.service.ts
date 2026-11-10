import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { bookingPolicy, bookingWindow } from './policy.js';
import type { AppointmentStatus, UserRole } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';

const include = { slot: true, events: { orderBy: { createdAt: 'asc' as const } },
  attachments: { select: { id: true, originalName: true, verifiedMime: true, size: true } } };

function invalid(message: string): never { throw new BadRequestException({ code: 'VALIDATION_ERROR', message }); }
function changed(): never { throw new ConflictException({ code: 'APPOINTMENT_CHANGED', message: 'Appointment changed; reload it' }); }
function missing(): never { throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' }); }
function parseVersion(body: unknown): { expectedVersion: number; value: Record<string, unknown> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Invalid action data');
  const value = body as Record<string, unknown>;
  if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1) return invalid('Expected version is required');
  return { expectedVersion: Number(value.expectedVersion), value };
}
function parseReason(value: Record<string, unknown>, cancellation = false): string {
  if (cancellation) {
    if (!['CHANGE_PLANS', 'HEALTH_CHANGED', 'BOOKED_WRONG', 'OTHER'].includes(String(value.reason))) return invalid('Cancellation reason is required');
    const note = typeof value.note === 'string' ? value.note.trim() : '';
    if (note.length > 1000 || (value.reason === 'OTHER' && !note)) return invalid('Cancellation note is required');
    return `${value.reason}${note ? `: ${note}` : ''}`;
  }
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) return invalid('Reason is required');
  return value.reason.trim();
}
function pageQuery(rawPage: unknown, rawSize: unknown) {
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const pageSize = rawSize === undefined ? 10 : Number(rawSize);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) return invalid('Invalid page');
  return { page, pageSize };
}
function statusQuery(raw: unknown): AppointmentStatus | undefined {
  if (raw === undefined) return undefined;
  if (!['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(String(raw))) return invalid('Invalid status');
  return raw as AppointmentStatus;
}

@Injectable()
export class ManagementService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  private actions(status: AppointmentStatus, startsAt: Date, cancelDeadline: Date, rescheduleDeadline: Date,
    role: UserRole, owner: boolean) {
    const now = Date.now();
    return {
      cancel: owner && ['PENDING', 'CONFIRMED'].includes(status) && now < cancelDeadline.getTime(),
      reschedule: owner && ['PENDING', 'CONFIRMED'].includes(status) && now < rescheduleDeadline.getTime(),
      rebook: owner,
      calendar: owner && status === 'CONFIRMED',
      confirm: !owner && role !== 'PATIENT' && status === 'PENDING' && now < startsAt.getTime(),
      reject: !owner && role !== 'PATIENT' && status === 'PENDING',
      operationCancel: !owner && role !== 'PATIENT' &&
        (status === 'PENDING' || (status === 'CONFIRMED' && now < startsAt.getTime())),
      complete: !owner && role !== 'PATIENT' && status === 'CONFIRMED' && now >= startsAt.getTime(),
    };
  }

  private view(appointment: Prisma.AppointmentGetPayload<{ include: typeof include }>, role: UserRole, owner: boolean) {
    return { id: appointment.id, code: appointment.code, status: appointment.status, version: appointment.version,
      doctorId: appointment.doctorId, doctorName: appointment.doctorNameSnapshot, address: appointment.addressSnapshot,
      consultationFee: appointment.feeSnapshot.toString(), patient: appointment.patientSnapshot,
      reason: appointment.reason, symptoms: appointment.symptoms, startsAt: appointment.slot.startsAt.toISOString(),
      endsAt: appointment.slot.endsAt.toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      policy: appointment.policySnapshot,
      cancelDeadline: appointment.cancelDeadline.toISOString(), rescheduleDeadline: appointment.rescheduleDeadline.toISOString(),
      allowedActions: this.actions(appointment.status, appointment.slot.startsAt, appointment.cancelDeadline,
        appointment.rescheduleDeadline, role, owner),
      attachments: appointment.attachments, events: appointment.events };
  }

  async ownerList(userId: string, rawStatus: unknown, rawPage: unknown, rawSize: unknown) {
    const { page, pageSize } = pageQuery(rawPage, rawSize);
    const status = statusQuery(rawStatus);
    const where: Prisma.AppointmentWhereInput = { bookerId: userId, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items: items.map((item) => this.view(item, 'PATIENT', true)), total, page, pageSize,
      totalPages: Math.ceil(total / pageSize) };
  }

  async operationList(userId: string, rawStatus: unknown, rawPage: unknown, rawSize: unknown, doctorId?: string) {
    const access = await this.access.capabilities(userId);
    if (access.role === 'PATIENT') return missing();
    if (doctorId && access.role === 'DOCTOR' && doctorId !== access.doctorId) return missing();
    const { page, pageSize } = pageQuery(rawPage, rawSize);
    const status = statusQuery(rawStatus) ?? 'PENDING';
    const where: Prisma.AppointmentWhereInput = { status, doctorId: access.role === 'DOCTOR' ? access.doctorId! : doctorId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({ where, include, orderBy: [{ slot: { startsAt: 'asc' } }, { id: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize }), this.prisma.appointment.count({ where }),
    ]);
    return { items: items.map((item) => this.view(item, access.role, false)), total, page, pageSize,
      totalPages: Math.ceil(total / pageSize) };
  }

  async ownerDetail(userId: string, id: string) {
    const item = await this.prisma.appointment.findFirst({ where: { id, bookerId: userId }, include });
    if (!item) return missing();
    return this.view(item, 'PATIENT', true);
  }

  async operationDetail(userId: string, id: string) {
    const access = await this.access.capabilities(userId);
    if (access.role === 'PATIENT') return missing();
    const item = await this.prisma.appointment.findFirst({ where: { id,
      ...(access.role === 'DOCTOR' ? { doctorId: access.doctorId! } : {}) }, include });
    if (!item) return missing();
    return this.view(item, access.role, false);
  }

  async rebook(userId: string, id: string) {
    const old = await this.prisma.appointment.findFirst({ where: { id, bookerId: userId },
      include: { doctor: { select: { id: true, isActive: true, name: true } }, patientProfile: true } });
    if (!old) return missing();
    if (!old.doctor.isActive) throw new ConflictException({ code: 'DOCTOR_INACTIVE', message: 'Doctor no longer accepts bookings' });
    return { doctor: old.doctor, patientProfile: { id: old.patientProfile.id, fullName: old.patientProfile.fullName,
      birthDate: old.patientProfile.birthDate.toISOString().slice(0, 10) } };
  }

  async ownerAction(userId: string, id: string, kind: 'cancel' | 'reschedule', body: unknown) {
    const parsed = parseVersion(body);
    const reason = kind === 'cancel' ? parseReason(parsed.value, true) : null;
    const newSlotId = kind === 'reschedule' && typeof parsed.value.newSlotId === 'string' ? parsed.value.newSlotId : null;
    if (kind === 'reschedule' && !newSlotId) return invalid('New slot is required');
    return this.change(userId, id, parsed.expectedVersion, kind, reason, newSlotId, true);
  }

  async operationAction(userId: string, id: string, kind: 'confirm' | 'reject' | 'cancel' | 'complete', body: unknown) {
    const parsed = parseVersion(body);
    const reason = kind === 'reject' || kind === 'cancel' ? parseReason(parsed.value) : null;
    return this.change(userId, id, parsed.expectedVersion, kind, reason, null, false);
  }

  private async change(actorId: string, id: string, expectedVersion: number,
    kind: 'cancel' | 'reschedule' | 'confirm' | 'reject' | 'complete', reason: string | null,
    newSlotId: string | null, owner: boolean) {
    const target = await this.prisma.appointment.findUnique({ where: { id }, select: { doctorId: true } });
    if (!target) return missing();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Doctor WHERE id = ${target.doctorId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM Appointment WHERE id = ${id} FOR UPDATE`;
      const item = await tx.appointment.findUnique({ where: { id }, include: { slot: true } });
      if (!item || item.doctorId !== target.doctorId) return missing();
      if (owner) {
        if (item.bookerId !== actorId) return missing();
      } else {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, doctorId: true } });
        if (!actor || (actor.role !== 'ADMIN' && (actor.role !== 'DOCTOR' || actor.doctorId !== item.doctorId))) return missing();
      }
      if (item.version !== expectedVersion) return changed();
      const now = Date.now();
      const isOpen = item.status === 'PENDING' || item.status === 'CONFIRMED';
      if (owner && (!isOpen || (kind === 'cancel' && now >= item.cancelDeadline.getTime()) ||
        (kind === 'reschedule' && now >= item.rescheduleDeadline.getTime()))) return changed();
      if (!owner) {
        if (kind === 'confirm' && (item.status !== 'PENDING' || now >= item.slot.startsAt.getTime())) return changed();
        if (kind === 'reject' && item.status !== 'PENDING') return changed();
        if (kind === 'complete' && (item.status !== 'CONFIRMED' || now < item.slot.startsAt.getTime())) return changed();
        if (kind === 'cancel' && (item.status !== 'PENDING' &&
          !(item.status === 'CONFIRMED' && now < item.slot.startsAt.getTime()))) return changed();
      }
      const oldStatus = item.status;
      let nextStatus: AppointmentStatus = item.status;
      let nextSlotId = item.slotId;
      let deadline = item.cancelDeadline;
      if (kind === 'reschedule') {
        if (newSlotId === item.slotId) return invalid('Choose a different slot');
        const next = await tx.appointmentSlot.findUnique({ where: { id: newSlotId! }, include: { occupancy: true } });
        if (!next || next.doctorId !== item.doctorId || !next.isOpen || next.occupancy || !bookingWindow(next.startsAt)) {
          throw new ConflictException({ code: 'SLOT_UNAVAILABLE', message: 'Slot is no longer available' });
        }
        await tx.slotOccupancy.delete({ where: { slotId: item.slotId } });
        nextSlotId = next.id;
        nextStatus = 'PENDING';
        deadline = new Date(next.startsAt.getTime() - bookingPolicy().changeHours * 3_600_000);
      } else if (kind === 'confirm') nextStatus = 'CONFIRMED';
      else if (kind === 'complete') nextStatus = 'COMPLETED';
      else nextStatus = 'CANCELLED';
      const updated = await tx.appointment.updateMany({ where: { id, version: expectedVersion, status: oldStatus },
        data: { status: nextStatus, version: { increment: 1 }, slotId: nextSlotId,
          cancelDeadline: deadline, rescheduleDeadline: deadline } });
      if (updated.count !== 1) return changed();
      if (kind === 'reschedule') await tx.slotOccupancy.create({ data: { slotId: nextSlotId, appointmentId: id } });
      else if (nextStatus === 'CANCELLED' || nextStatus === 'COMPLETED') {
        await tx.slotOccupancy.deleteMany({ where: { slotId: item.slotId, appointmentId: id } });
      }
      await tx.appointmentEvent.create({ data: { appointmentId: id, actorId, type: kind.toUpperCase(),
        oldStatus, newStatus: nextStatus, oldSlotId: item.slotId, newSlotId: nextSlotId,
        reason, version: expectedVersion + 1 } });
      const result = await tx.appointment.findUniqueOrThrow({ where: { id }, include });
      const actorRole: UserRole = owner ? 'PATIENT' : (await tx.user.findUniqueOrThrow({
        where: { id: actorId }, select: { role: true } })).role;
      return this.view(result, actorRole, owner);
    });
  }
}
