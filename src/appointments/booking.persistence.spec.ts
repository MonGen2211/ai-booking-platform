import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingService } from './booking.service.js';
import { ManagementService } from './management.service.js';
import { AccessService } from '../access/access.service.js';

describe.runIf(process.env.APPOINTMENT_DATABASE_TEST === 'true')('booking on MySQL', () => {
  it('uses one occupancy for concurrent requests, preserves snapshots and repeats an idempotent result', async () => {
    const prisma = new PrismaService();
    const service = new BookingService(prisma);
    const doctorId = randomUUID();
    const users = [randomUUID(), randomUUID()];
    const slotStart = new Date(Date.now() + 4 * 86_400_000);
    let slotId: string | undefined;
    const profiles: string[] = [];
    try {
      await prisma.$connect();
      await prisma.doctor.create({ data: { id: doctorId, name: 'Dr Test', specialty: 'General',
        introduction: 'Test', qualifications: 'MD', consultationFee: '100000', address: 'Clinic A' } });
      await prisma.user.createMany({ data: users.map((id) => ({ id, email: `${id}@example.test`, passwordHash: 'test' })) });
      for (const ownerId of users) {
        const patient = await prisma.patientProfile.create({ data: { ownerId, kind: 'SELF', fullName: 'Patient',
          birthDate: new Date('2000-01-01T00:00:00Z'), phone: '0123456789' } });
        profiles.push(patient.id);
      }
      const slot = await prisma.appointmentSlot.create({ data: { doctorId, startsAt: slotStart,
        endsAt: new Date(slotStart.getTime() + 30 * 60_000) } });
      slotId = slot.id;
      const makeBody = (profileId: string) => ({ slotId, profileId, reason: 'Checkup', symptoms: '',
        attachmentIds: [], acceptedDetails: { consultationFee: '100000', address: 'Clinic A' } });
      const first = await service.create(users[0], randomUUID(), makeBody(profiles[0]));
      const repeatKey = randomUUID();
      const secondStart = new Date(slotStart.getTime() + 30 * 60_000);
      const slot2 = await prisma.appointmentSlot.create({ data: { doctorId, startsAt: secondStart,
        endsAt: new Date(secondStart.getTime() + 30 * 60_000) } });
      const body2 = { ...makeBody(profiles[0]), slotId: slot2.id };
      const [repeatedA, repeatedB] = await Promise.all([
        service.create(users[0], repeatKey, body2), service.create(users[0], repeatKey, body2),
      ]);
      expect(repeatedA.id).toBe(repeatedB.id);
      await expect(service.create(users[0], repeatKey, { ...body2, reason: 'Different' })).rejects.toMatchObject({ status: 409 });
      const thirdStart = new Date(secondStart.getTime() + 30 * 60_000);
      const slot3 = await prisma.appointmentSlot.create({ data: { doctorId, startsAt: thirdStart,
        endsAt: new Date(thirdStart.getTime() + 30 * 60_000) } });
      await expect(service.create(users[1], randomUUID(), makeBody(profiles[1]))).rejects.toMatchObject({
        status: 409, response: expect.objectContaining({ code: 'SLOT_UNAVAILABLE',
          suggestions: expect.arrayContaining([expect.objectContaining({ id: slot3.id })]) }),
      });
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot.id } })).toBe(1);
      await prisma.patientProfile.update({ where: { id: profiles[0] }, data: { fullName: 'Changed' } });
      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } });
      expect(stored.patientSnapshot).toMatchObject({ fullName: 'Patient' });
      expect(await prisma.appointment.count({ where: { doctorId } })).toBe(2);
      const races = await Promise.allSettled([
        service.create(users[0], randomUUID(), { ...makeBody(profiles[0]), slotId: slot3.id }),
        service.create(users[1], randomUUID(), { ...makeBody(profiles[1]), slotId: slot3.id }),
      ]);
      expect(races.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot3.id } })).toBe(1);
      const slot4 = await prisma.appointmentSlot.create({ data: { doctorId,
        startsAt: new Date(thirdStart.getTime() + 30 * 60_000),
        endsAt: new Date(thirdStart.getTime() + 60 * 60_000) } });
      await expect(service.create(users[1], randomUUID(), { ...makeBody(profiles[1]), slotId: slot4.id,
        acceptedDetails: { consultationFee: '100000', address: 'Changed clinic' } }))
        .rejects.toMatchObject({ status: 409 });
      await expect(service.create(users[1], randomUUID(), { ...makeBody(profiles[1]), slotId: slot4.id,
        attachmentIds: ['expired-or-foreign'] })).rejects.toMatchObject({ status: 400 });
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot4.id } })).toBe(0);
      await prisma.user.update({ where: { id: users[1] }, data: { role: 'DOCTOR', doctorId } });
      const management = new ManagementService(prisma, new AccessService(prisma));
      expect((await management.ownerList(users[0], 'PENDING', 1, 10)).total).toBeGreaterThan(0);
      await expect(management.ownerList(users[0], 'PENDING', 1, 51)).rejects.toMatchObject({ status: 400 });
      expect((await management.operationList(users[1], 'PENDING', 1, 10)).total).toBeGreaterThan(0);
      await expect(management.ownerDetail(users[1], first.id)).rejects.toMatchObject({ status: 404 });
      const confirmed = await management.operationAction(users[1], first.id, 'confirm', { expectedVersion: 1 });
      expect(confirmed.status).toBe('CONFIRMED');
      await expect(management.operationAction(users[1], first.id, 'reject', { expectedVersion: 1, reason: 'No' }))
        .rejects.toMatchObject({ status: 409 });
      await expect(management.ownerAction(users[0], first.id, 'reschedule',
        { expectedVersion: 2, newSlotId: slot2.id })).rejects.toMatchObject({ status: 409 });
      await expect(management.ownerAction(users[0], first.id, 'reschedule',
        { expectedVersion: 2, newSlotId: slot.id })).rejects.toMatchObject({ status: 400 });
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot.id } })).toBe(1);
      const moved = await management.ownerAction(users[0], first.id, 'reschedule',
        { expectedVersion: 2, newSlotId: slot4.id });
      expect(moved.status).toBe('PENDING');
      expect(moved.code).toBe(first.code);
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot.id } })).toBe(0);
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot4.id } })).toBe(1);
      await management.operationAction(users[1], first.id, 'confirm', { expectedVersion: 3 });
      const cancelled = await management.ownerAction(users[0], first.id, 'cancel',
        { expectedVersion: 4, reason: 'OTHER', note: 'Plans changed' });
      expect(cancelled.status).toBe('CANCELLED');
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot4.id } })).toBe(0);
      expect((await management.rebook(users[0], first.id)).doctor.id).toBe(doctorId);
      const rejected = await management.operationAction(users[1], repeatedA.id, 'reject',
        { expectedVersion: 1, reason: 'Doctor unavailable' });
      expect(rejected.status).toBe('CANCELLED');
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot2.id } })).toBe(0);
      const raceWinner = races.find((result) => result.status === 'fulfilled');
      if (!raceWinner || raceWinner.status !== 'fulfilled') throw new Error('Expected a booking winner');
      await management.operationAction(users[1], raceWinner.value.id, 'confirm', { expectedVersion: 1 });
      await prisma.appointmentSlot.update({ where: { id: slot3.id }, data: {
        startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() - 30_000) } });
      const completed = await management.operationAction(users[1], raceWinner.value.id, 'complete', { expectedVersion: 2 });
      expect(completed.status).toBe('COMPLETED');
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot3.id } })).toBe(0);
      await expect(management.ownerAction(users[0], raceWinner.value.id, 'cancel',
        { expectedVersion: 3, reason: 'CHANGE_PLANS' })).rejects.toMatchObject({ status: 409 });
      const attachment = await prisma.appointmentAttachment.create({ data: { ownerId: users[0],
        storageKey: randomUUID(), originalName: 'scan.pdf', verifiedMime: 'application/pdf', size: 9,
        expiresAt: new Date(Date.now() + 3_600_000) } });
      const withAttachment = await service.create(users[0], randomUUID(), { ...makeBody(profiles[0]),
        slotId: slot4.id, attachmentIds: [attachment.id] });
      expect((await prisma.appointmentAttachment.findUniqueOrThrow({ where: { id: attachment.id } })).appointmentId)
        .toBe(withAttachment.id);
      const slot5 = await prisma.appointmentSlot.create({ data: { doctorId,
        startsAt: new Date(thirdStart.getTime() + 60 * 60_000),
        endsAt: new Date(thirdStart.getTime() + 90 * 60_000) } });
      await expect(service.create(users[0], randomUUID(), { ...makeBody(profiles[0]),
        slotId: slot5.id, attachmentIds: [attachment.id] })).rejects.toMatchObject({ status: 400 });
      expect(await prisma.slotOccupancy.count({ where: { slotId: slot5.id } })).toBe(0);
      const overdue = await service.create(users[0], randomUUID(), { ...makeBody(profiles[0]), slotId: slot5.id });
      await prisma.appointment.update({ where: { id: overdue.id }, data: { cancelDeadline: new Date(Date.now() - 1000) } });
      await expect(management.ownerAction(users[0], overdue.id, 'cancel',
        { expectedVersion: 1, reason: 'BOOKED_WRONG' })).rejects.toMatchObject({ status: 409 });
      await prisma.appointmentSlot.update({ where: { id: slot5.id }, data: {
        startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() - 30_000) } });
      await expect(management.operationAction(users[1], overdue.id, 'confirm', { expectedVersion: 1 }))
        .rejects.toMatchObject({ status: 409 });
      expect((await management.operationAction(users[1], overdue.id, 'cancel',
        { expectedVersion: 1, reason: 'Expired pending request' })).status).toBe('CANCELLED');
      await prisma.doctor.update({ where: { id: doctorId }, data: { isActive: false } });
      const slot6 = await prisma.appointmentSlot.create({ data: { doctorId,
        startsAt: new Date(thirdStart.getTime() + 90 * 60_000),
        endsAt: new Date(thirdStart.getTime() + 120 * 60_000) } });
      await expect(service.create(users[1], randomUUID(), { ...makeBody(profiles[1]), slotId: slot6.id }))
        .rejects.toMatchObject({ status: 404 });
      await expect(service.create(users[1], randomUUID(), { ...makeBody(profiles[1]), slotId: 'missing' }))
        .rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: users } } });
      await prisma.appointmentEvent.deleteMany({ where: { actorId: { in: users } } });
      await prisma.slotOccupancy.deleteMany({ where: { slot: { doctorId } } });
      await prisma.appointmentAttachment.deleteMany({ where: { ownerId: { in: users } } });
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.appointmentSlot.deleteMany({ where: { doctorId } });
      await prisma.patientProfile.deleteMany({ where: { ownerId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.$disconnect();
    }
  });
});
