import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { AvailabilityService } from './availability.service.js';
import { BookingService } from './booking.service.js';
import { addDays, vietnamDate } from './policy.js';

describe.runIf(process.env.APPOINTMENT_DATABASE_TEST === 'true')('appointment availability on MySQL', () => {
  it('materializes slots idempotently and protects an occupied slot when closing a day', async () => {
    const prisma = new PrismaService();
    const doctorId = randomUUID();
    const userId = randomUUID();
    const doctor = { id: doctorId, name: 'Test doctor', specialty: 'General', introduction: 'Test',
      qualifications: 'MD', experienceYears: 1, consultationFee: '100000', address: 'Test address' };
    const service = new AvailabilityService(prisma, {
      requireDoctor: async () => undefined,
    } as unknown as AccessService);
    const date = addDays(vietnamDate(new Date()), 3);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const schedule = { weekly: [{ weekday, startMinute: 540, endMinute: 600, durationMinutes: 30,
      effectiveFrom: date }], exceptions: [] };
    let appointmentId: string | undefined;
    try {
      await prisma.$connect();
      await prisma.doctor.create({ data: doctor });
      await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, passwordHash: 'test' } });
      await service.saveSchedule(userId, doctorId, schedule);
      await service.saveSchedule(userId, doctorId, schedule);
      const slots = await prisma.appointmentSlot.findMany({ where: { doctorId, isOpen: true } });
      expect(slots).toHaveLength(18);
      expect((await service.availability(doctorId, date, date)).items).toHaveLength(2);
      await expect(service.availability(doctorId, date, addDays(date, 31))).rejects.toMatchObject({ status: 400 });
      await expect(service.availability(doctorId, addDays(date, 1), addDays(date, 1)))
        .resolves.toMatchObject({ items: [] });
      const patient = await prisma.patientProfile.create({ data: { ownerId: userId, kind: 'SELF',
        fullName: 'Test patient', birthDate: new Date('2000-01-01T00:00:00Z'), phone: '0123456789' } });
      const appointment = await prisma.appointment.create({ data: { code: randomUUID().slice(0, 20),
        bookerId: userId, patientProfileId: patient.id, doctorId, slotId: slots[0].id,
        reason: 'Test', patientSnapshot: { fullName: 'Test patient' }, doctorNameSnapshot: doctor.name,
        addressSnapshot: doctor.address, feeSnapshot: doctor.consultationFee,
        cancelDeadline: slots[0].startsAt, rescheduleDeadline: slots[0].startsAt, policySnapshot: {} } });
      appointmentId = appointment.id;
      await prisma.slotOccupancy.create({ data: { slotId: slots[0].id, appointmentId } });
      expect((await service.availability(doctorId, date, date)).items).toHaveLength(1);
      await expect(service.saveSchedule(userId, doctorId, { weekly: [], exceptions: [] }))
        .rejects.toMatchObject({ status: 409 });
      expect(await prisma.appointmentSlot.count({ where: { doctorId, isOpen: true } })).toBe(18);
      expect(await prisma.doctorSchedule.count({ where: { doctorId } })).toBe(1);
      await prisma.doctor.update({ where: { id: doctorId }, data: { isActive: false } });
      await expect(service.availability(doctorId, date, date)).rejects.toMatchObject({ status: 404 });
    } finally {
      if (appointmentId) {
        await prisma.slotOccupancy.deleteMany({ where: { appointmentId } });
        await prisma.appointment.deleteMany({ where: { id: appointmentId } });
      }
      await prisma.patientProfile.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.appointmentSlot.deleteMany({ where: { doctorId } });
      await prisma.doctorScheduleException.deleteMany({ where: { doctorId } });
      await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.$disconnect();
    }
  });

  it('serializes a schedule closure against a booking of the affected slot', async () => {
    const prisma = new PrismaService();
    const doctorId = randomUUID();
    const userId = randomUUID();
    const date = addDays(vietnamDate(new Date()), 3);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const availability = new AvailabilityService(prisma, { requireDoctor: async () => undefined } as unknown as AccessService);
    const booking = new BookingService(prisma);
    try {
      await prisma.$connect();
      await prisma.doctor.create({ data: { id: doctorId, name: 'Test doctor', specialty: 'General',
        introduction: 'Test', qualifications: 'MD', consultationFee: '100000', address: 'Clinic A' } });
      await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, passwordHash: 'test' } });
      const profile = await prisma.patientProfile.create({ data: { ownerId: userId, kind: 'SELF',
        fullName: 'Patient', birthDate: new Date('2000-01-01T00:00:00Z'), phone: '0123456789' } });
      await availability.saveSchedule(userId, doctorId, { weekly: [{ weekday, startMinute: 540, endMinute: 570,
        durationMinutes: 30, effectiveFrom: date }], exceptions: [] });
      const slot = await prisma.appointmentSlot.findFirstOrThrow({ where: { doctorId, isOpen: true } });
      const results = await Promise.allSettled([
        availability.saveSchedule(userId, doctorId, { weekly: [], exceptions: [] }),
        booking.create(userId, randomUUID(), { slotId: slot.id, profileId: profile.id, reason: 'Checkup',
          symptoms: '', attachmentIds: [], acceptedDetails: { consultationFee: '100000', address: 'Clinic A' } }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const current = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slot.id }, include: { occupancy: true } });
      expect(current.isOpen || !current.occupancy).toBe(true);
      if (current.occupancy) expect(current.isOpen).toBe(true);
    } finally {
      await prisma.idempotencyRecord.deleteMany({ where: { userId } });
      await prisma.appointmentEvent.deleteMany({ where: { actorId: userId } });
      await prisma.slotOccupancy.deleteMany({ where: { slot: { doctorId } } });
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.appointmentSlot.deleteMany({ where: { doctorId } });
      await prisma.doctorScheduleException.deleteMany({ where: { doctorId } });
      await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
      await prisma.patientProfile.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.$disconnect();
    }
  });
});
