import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { bookingPolicy, bookingWindow } from './policy.js';
import type { Prisma } from '../generated/prisma/client.js';

type BookingInput = { slotId: string; profileId: string; reason: string; symptoms: string | null;
  attachmentIds: string[]; acceptedDetails: { consultationFee: string; address: string } };

function invalid(message: string): never { throw new BadRequestException({ code: 'VALIDATION_ERROR', message }); }
function conflict(code: string, message: string): never { throw new ConflictException({ code, message }); }

function parseBooking(body: unknown): BookingInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Invalid booking data');
  const raw = body as Record<string, unknown>;
  if (typeof raw.slotId !== 'string' || !raw.slotId || typeof raw.profileId !== 'string' || !raw.profileId ||
    typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.length > 2000 ||
    (raw.symptoms != null && (typeof raw.symptoms !== 'string' || raw.symptoms.length > 4000)) ||
    !Array.isArray(raw.attachmentIds) || raw.attachmentIds.length > 5 ||
    raw.attachmentIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(raw.attachmentIds).size !== raw.attachmentIds.length) return invalid('Invalid booking data');
  const details = raw.acceptedDetails;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return invalid('Accepted details are required');
  const acceptedDetails = details as Record<string, unknown>;
  if (typeof acceptedDetails.consultationFee !== 'string' || !/^\d+(\.\d{1,2})?$/.test(acceptedDetails.consultationFee) ||
    typeof acceptedDetails.address !== 'string' || !acceptedDetails.address) return invalid('Invalid accepted details');
  return { slotId: raw.slotId, profileId: raw.profileId, reason: raw.reason.trim(),
    symptoms: raw.symptoms == null ? null : String(raw.symptoms).trim(), attachmentIds: raw.attachmentIds as string[],
    acceptedDetails: { consultationFee: acceptedDetails.consultationFee, address: acceptedDetails.address } };
}

function hashInput(input: BookingInput) {
  return createHash('sha256').update(JSON.stringify({ ...input, attachmentIds: [...input.attachmentIds].sort() })).digest('hex');
}

function isDeadlock(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010' || !('meta' in error)) return false;
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '1213' || meta?.code === '1205';
}

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, key: string | undefined, body: unknown) {
    if (!key || !/^[A-Za-z0-9_.:-]{8,191}$/.test(key)) return invalid('Idempotency-Key is required');
    const input = parseBooking(body);
    const requestHash = hashInput(input);
    const targetSlot = await this.prisma.appointmentSlot.findUnique({ where: { id: input.slotId }, select: { doctorId: true } });
    if (!targetSlot) throw new NotFoundException({ code: 'SLOT_NOT_FOUND', message: 'Slot not found' });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM Doctor WHERE id = ${targetSlot.doctorId} FOR UPDATE`;
          const previous = await tx.idempotencyRecord.findUnique({ where: { userId_operation_key: {
            userId, operation: 'CREATE_APPOINTMENT', key } }, include: { appointment: { include: { slot: true } } } });
          if (previous) {
            if (previous.normalizedRequestHash !== requestHash) conflict('IDEMPOTENCY_CONFLICT', 'Key used for another request');
            return previous.appointment;
          }
          // Read the slot only after locking the doctor. Earlier consistent reads could pin a stale MySQL snapshot.
          const current = await tx.appointmentSlot.findUnique({ where: { id: input.slotId }, include: { occupancy: true,
            doctor: { select: { id: true, isActive: true, name: true, address: true, consultationFee: true } } } });
          if (!current || current.doctorId !== targetSlot.doctorId || !current.isOpen || current.occupancy || !bookingWindow(current.startsAt)) {
            conflict('SLOT_UNAVAILABLE', 'Slot is no longer available');
          }
          if (!current.doctor.isActive) throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' });
          if (current.doctor.address !== input.acceptedDetails.address ||
            Number(current.doctor.consultationFee) !== Number(input.acceptedDetails.consultationFee)) {
            conflict('BOOKING_DETAILS_CHANGED', 'Doctor details changed; confirm again');
          }
          const profile = await tx.patientProfile.findFirst({ where: { id: input.profileId, ownerId: userId } });
          if (!profile) throw new NotFoundException({ code: 'PROFILE_NOT_FOUND', message: 'Patient profile not found' });
          const files = await tx.appointmentAttachment.findMany({ where: { id: { in: input.attachmentIds }, ownerId: userId,
            appointmentId: null, expiresAt: { gt: new Date() } }, select: { id: true } });
          if (files.length !== input.attachmentIds.length) return invalid('Invalid or expired attachment');
          const policy = bookingPolicy();
          const deadline = new Date(current.startsAt.getTime() - policy.changeHours * 3_600_000);
          const appointment = await tx.appointment.create({ data: {
            code: `BK-${randomBytes(8).toString('hex').toUpperCase()}`, bookerId: userId, patientProfileId: profile.id,
            doctorId: current.doctorId, slotId: current.id, status: 'PENDING', reason: input.reason,
            symptoms: input.symptoms, patientSnapshot: { kind: profile.kind, fullName: profile.fullName,
              birthDate: profile.birthDate.toISOString().slice(0, 10), phone: profile.phone, relationship: profile.relationship },
            doctorNameSnapshot: current.doctor.name, addressSnapshot: current.doctor.address,
            feeSnapshot: current.doctor.consultationFee, cancelDeadline: deadline, rescheduleDeadline: deadline,
            policySnapshot: policy,
          }, include: { slot: true } });
          await tx.slotOccupancy.create({ data: { slotId: current.id, appointmentId: appointment.id } });
          if (files.length) {
            const attached = await tx.appointmentAttachment.updateMany({ where: { id: { in: input.attachmentIds },
              ownerId: userId, appointmentId: null, expiresAt: { gt: new Date() } }, data: { appointmentId: appointment.id } });
            if (attached.count !== files.length) return invalid('Attachment changed; upload again');
          }
          await tx.appointmentEvent.create({ data: { appointmentId: appointment.id, actorId: userId,
            type: 'CREATED', newStatus: 'PENDING', newSlotId: current.id, version: 1 } });
          await tx.idempotencyRecord.create({ data: { userId, operation: 'CREATE_APPOINTMENT', key,
            normalizedRequestHash: requestHash, appointmentId: appointment.id } });
          return appointment;
        });
        return this.view(result);
      } catch (error) {
        const code = error instanceof ConflictException ? (error.getResponse() as { code?: string }).code : undefined;
        const uniqueError = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
        const occupied = uniqueError && !!(await this.prisma.slotOccupancy.findUnique({ where: { slotId: input.slotId }, select: { slotId: true } }));
        if (code === 'SLOT_UNAVAILABLE' || occupied) {
          throw new ConflictException({ code: 'SLOT_UNAVAILABLE', message: 'Slot is no longer available',
            suggestions: await this.suggestions(input.slotId) });
        }
        if (uniqueError && attempt < 2) continue;
        if (isDeadlock(error) && attempt < 2) continue;
        if (isDeadlock(error)) {
          throw new ServiceUnavailableException({ code: 'BOOKING_UNAVAILABLE', message: 'Please retry booking' });
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException({ code: 'BOOKING_UNAVAILABLE', message: 'Please retry booking' });
  }

  async suggestions(slotId: string) {
    const old = await this.prisma.appointmentSlot.findUnique({ where: { id: slotId }, select: { doctorId: true,
      startsAt: true, doctor: { select: { isActive: true } } } });
    if (!old || !old.doctor.isActive) return [];
    const policy = bookingPolicy();
    const now = Date.now();
    const earliest = new Date(Math.max(old.startsAt.getTime() + 1, now + policy.leadHours * 3_600_000));
    const latest = new Date(now + policy.horizonDays * 86_400_000);
    const slots = await this.prisma.appointmentSlot.findMany({ where: { doctorId: old.doctorId, isOpen: true,
      startsAt: { gte: earliest, lte: latest }, occupancy: null }, orderBy: { startsAt: 'asc' }, take: 5 });
    return slots.map((slot) => ({ id: slot.id,
      startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() }));
  }

  view(appointment: { id: string; code: string; status: string; version: number; slot: { startsAt: Date; endsAt: Date };
    doctorId: string; patientSnapshot: Prisma.JsonValue; feeSnapshot: { toString(): string }; addressSnapshot: string;
    doctorNameSnapshot: string; cancelDeadline: Date; rescheduleDeadline: Date }) {
    return { id: appointment.id, code: appointment.code, status: appointment.status, version: appointment.version,
      doctorId: appointment.doctorId, patient: appointment.patientSnapshot, doctorName: appointment.doctorNameSnapshot,
      address: appointment.addressSnapshot, consultationFee: appointment.feeSnapshot.toString(),
      startsAt: appointment.slot.startsAt.toISOString(), endsAt: appointment.slot.endsAt.toISOString(),
      cancelDeadline: appointment.cancelDeadline.toISOString(),
      rescheduleDeadline: appointment.rescheduleDeadline.toISOString() };
  }
}
