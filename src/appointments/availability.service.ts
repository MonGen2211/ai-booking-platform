import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { addDays, bookingPolicy, bookingWindow, parseDateOnly, parseSchedule, vietnamDate, vietnamInstant, weekday,
  type ScheduleInterval, type WeeklyInterval, type ScheduleException } from './policy.js';
import type { Prisma } from '../generated/prisma/client.js';

const dayDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
type Candidate = { startsAt: Date; endsAt: Date };

function slotsForDate(date: string, weekly: WeeklyInterval[], exceptions: ScheduleException[]): Candidate[] {
  const exception = exceptions.find((item) => item.date === date);
  const intervals: ScheduleInterval[] = exception
    ? exception.isClosed ? [] : exception.intervals ?? []
    : weekly.filter((item) => item.weekday === weekday(date) && item.effectiveFrom <= date &&
        (!item.effectiveTo || item.effectiveTo >= date));
  const slots: Candidate[] = [];
  for (const interval of intervals) {
    for (let minute = interval.startMinute; minute + interval.durationMinutes <= interval.endMinute; minute += interval.durationMinutes) {
      slots.push({ startsAt: vietnamInstant(date, minute), endsAt: vietnamInstant(date, minute + interval.durationMinutes) });
    }
  }
  return slots;
}

@Injectable()
export class AvailabilityService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async onModuleInit() {
    await this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll().catch(() => undefined), 86_400_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async schedule(userId: string, doctorId: string) {
    await this.access.requireDoctor(userId, doctorId);
    const [weekly, exceptions] = await Promise.all([
      this.prisma.doctorSchedule.findMany({ where: { doctorId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.doctorScheduleException.findMany({ where: { doctorId }, orderBy: { date: 'asc' } }),
    ]);
    return { weekly: weekly.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute,
      endMinute: row.endMinute, durationMinutes: row.durationMinutes, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null })),
      exceptions: exceptions.map((row) => ({ date: row.date.toISOString().slice(0, 10),
        isClosed: row.isClosed, intervals: row.intervals ?? [] })), policy: bookingPolicy() };
  }

  async saveSchedule(userId: string, doctorId: string, body: unknown) {
    await this.access.requireDoctor(userId, doctorId);
    const parsed = parseSchedule(body);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Doctor WHERE id = ${doctorId} FOR UPDATE`;
      const doctor = await tx.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
      if (!doctor) throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' });
      await this.syncSlots(tx, doctorId, parsed.weekly, parsed.exceptions);
      await tx.doctorSchedule.deleteMany({ where: { doctorId } });
      await tx.doctorScheduleException.deleteMany({ where: { doctorId } });
      if (parsed.weekly.length) await tx.doctorSchedule.createMany({ data: parsed.weekly.map((row) => ({ doctorId,
        weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute, durationMinutes: row.durationMinutes,
        effectiveFrom: dayDate(row.effectiveFrom), effectiveTo: row.effectiveTo ? dayDate(row.effectiveTo) : null })) });
      for (const exception of parsed.exceptions) {
        await tx.doctorScheduleException.create({ data: { doctorId, date: dayDate(exception.date),
          isClosed: exception.isClosed, intervals: exception.intervals ?? [] } });
      }
    });
    return this.schedule(userId, doctorId);
  }

  private async syncSlots(tx: Prisma.TransactionClient, doctorId: string, weekly: WeeklyInterval[], exceptions: ScheduleException[]) {
    const policy = bookingPolicy();
    const today = vietnamDate(new Date());
    const desired = new Map<string, Candidate>();
    for (let i = 0; i <= policy.horizonDays; i++) {
      for (const slot of slotsForDate(addDays(today, i), weekly, exceptions)) {
        if (slot.startsAt.getTime() > Date.now()) desired.set(slot.startsAt.toISOString(), slot);
      }
    }
    const existing = await tx.appointmentSlot.findMany({
      where: { doctorId, startsAt: { gte: new Date() } }, include: { occupancy: true },
    });
    for (const slot of existing) {
      const next = desired.get(slot.startsAt.toISOString());
      const survives = !!next && next.endsAt.getTime() === slot.endsAt.getTime();
      if (!survives && slot.occupancy) throw new ConflictException({ code: 'AVAILABILITY_CONFLICT', message: 'Occupied slots must be handled first' });
      if (next && !survives) {
        await tx.appointmentSlot.update({ where: { id: slot.id }, data: { endsAt: next.endsAt,
          isOpen: true, scheduleVersion: { increment: 1 } } });
        desired.delete(slot.startsAt.toISOString());
        continue;
      }
      if (!survives && slot.isOpen) await tx.appointmentSlot.update({ where: { id: slot.id }, data: { isOpen: false, scheduleVersion: { increment: 1 } } });
      if (survives && !slot.isOpen) await tx.appointmentSlot.update({ where: { id: slot.id }, data: { isOpen: true, scheduleVersion: { increment: 1 } } });
      if (survives) desired.delete(slot.startsAt.toISOString());
    }
    for (const slot of desired.values()) {
      await tx.appointmentSlot.create({ data: { doctorId, ...slot } });
    }
  }

  async refreshAll(): Promise<void> {
    const doctors = await this.prisma.doctor.findMany({ where: { isActive: true, schedules: { some: {} } }, select: { id: true } });
    for (const doctor of doctors) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Doctor WHERE id = ${doctor.id} FOR UPDATE`;
        const [weeklyRows, exceptionRows] = await Promise.all([
          tx.doctorSchedule.findMany({ where: { doctorId: doctor.id } }),
          tx.doctorScheduleException.findMany({ where: { doctorId: doctor.id } }),
        ]);
        await this.syncSlots(tx, doctor.id,
          weeklyRows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute,
            durationMinutes: row.durationMinutes, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
            effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) })),
          exceptionRows.map((row) => ({ date: row.date.toISOString().slice(0, 10), isClosed: row.isClosed,
            intervals: row.intervals as ScheduleInterval[] ?? [] })));
      });
    }
  }

  async availability(doctorId: string, fromRaw: unknown, toRaw: unknown) {
    const from = parseDateOnly(fromRaw);
    const to = parseDateOnly(toRaw);
    const span = Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86_400_000);
    if (span < 0 || span > 30) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Date range must be 1 to 31 days' });
    const doctor = await this.prisma.doctor.findFirst({ where: { id: doctorId, isActive: true }, select: { id: true } });
    if (!doctor) throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' });
    const slots = await this.prisma.appointmentSlot.findMany({ where: { doctorId, isOpen: true,
      startsAt: { gte: vietnamInstant(from, 0), lt: vietnamInstant(addDays(to, 1), 0) }, occupancy: null },
      orderBy: { startsAt: 'asc' } });
    return { timezone: 'Asia/Ho_Chi_Minh', policy: bookingPolicy(), items: slots
      .filter((slot) => bookingWindow(slot.startsAt)).map((slot) => ({ id: slot.id,
        startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })) };
  }
}
