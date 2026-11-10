import { BadRequestException } from '@nestjs/common';

export const BOOKING_TIMEZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function envPositiveInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function bookingPolicy() {
  const slotMinutes = envPositiveInt('BOOKING_SLOT_MINUTES', 30);
  const leadHours = envPositiveInt('BOOKING_LEAD_HOURS', 2);
  const horizonDays = envPositiveInt('BOOKING_HORIZON_DAYS', 60);
  const changeHours = envPositiveInt('BOOKING_CHANGE_HOURS', 24);
  if (slotMinutes > 240 || 1440 % slotMinutes !== 0 || leadHours >= horizonDays * 24 ||
      horizonDays > 365 || changeHours > horizonDays * 24) {
    throw new Error('Booking policy is inconsistent');
  }
  return { slotMinutes, leadHours, horizonDays, changeHours, timezone: BOOKING_TIMEZONE };
}

export type ScheduleInterval = { startMinute: number; endMinute: number; durationMinutes: number };
export type WeeklyInterval = ScheduleInterval & { weekday: number; effectiveFrom: string; effectiveTo?: string };
export type ScheduleException = { date: string; isClosed: boolean; intervals?: ScheduleInterval[] };

function invalid(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

export function parseDateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ||
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    return invalid('Invalid date');
  }
  return value;
}

export function vietnamInstant(date: string, minuteOfDay: number): Date {
  return new Date(Date.parse(`${parseDateOnly(date)}T00:00:00.000Z`) + minuteOfDay * 60_000 - VIETNAM_OFFSET_MS);
}

export function vietnamDate(instant: Date): string {
  return new Date(instant.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${parseDateOnly(date)}T00:00:00.000Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${parseDateOnly(date)}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function parseInterval(raw: unknown): ScheduleInterval {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Invalid interval');
  const item = raw as Record<string, unknown>;
  const { startMinute, endMinute, durationMinutes } = item;
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || !Number.isInteger(durationMinutes) ||
      Number(startMinute) < 0 || Number(endMinute) > 1440 || Number(startMinute) >= Number(endMinute) ||
      Number(durationMinutes) < 5 || Number(durationMinutes) > 240 ||
      Number(durationMinutes) > Number(endMinute) - Number(startMinute)) return invalid('Invalid interval');
  return { startMinute: Number(startMinute), endMinute: Number(endMinute), durationMinutes: Number(durationMinutes) };
}

function assertNoOverlaps(intervals: ScheduleInterval[]): void {
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinute < sorted[i - 1].endMinute) invalid('Overlapping intervals');
  }
}

export function parseSchedule(body: unknown): { weekly: WeeklyInterval[]; exceptions: ScheduleException[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Invalid schedule');
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.weekly) || !Array.isArray(input.exceptions) || input.weekly.length > 100 || input.exceptions.length > 100) {
    return invalid('Invalid schedule');
  }
  const weekly = input.weekly.map((raw): WeeklyInterval => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Invalid weekly interval');
    const item = raw as Record<string, unknown>;
    if (!Number.isInteger(item.weekday) || Number(item.weekday) < 0 || Number(item.weekday) > 6) return invalid('Invalid weekday');
    const effectiveFrom = parseDateOnly(item.effectiveFrom);
    const effectiveTo = item.effectiveTo == null ? undefined : parseDateOnly(item.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) return invalid('Invalid effective dates');
    return { ...parseInterval(item), weekday: Number(item.weekday), effectiveFrom, effectiveTo };
  });
  for (let day = 0; day < 7; day++) {
    const rows = weekly.filter((row) => row.weekday === day);
    for (const row of rows) {
      const overlappingDates = rows.filter((other) => other !== row &&
        other.effectiveFrom <= (row.effectiveTo ?? '9999-12-31') && row.effectiveFrom <= (other.effectiveTo ?? '9999-12-31'));
      assertNoOverlaps([row, ...overlappingDates]);
    }
  }
  const seen = new Set<string>();
  const exceptions = input.exceptions.map((raw): ScheduleException => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Invalid exception');
    const item = raw as Record<string, unknown>;
    const date = parseDateOnly(item.date);
    if (seen.has(date) || typeof item.isClosed !== 'boolean') return invalid('Invalid exception');
    seen.add(date);
    const intervals = item.isClosed ? [] : Array.isArray(item.intervals) ? item.intervals.map(parseInterval) : invalid('Invalid exception intervals');
    assertNoOverlaps(intervals);
    return { date, isClosed: item.isClosed, intervals };
  });
  return { weekly, exceptions };
}

export function bookingWindow(startsAt: Date, now = new Date()): boolean {
  const policy = bookingPolicy();
  return startsAt.getTime() >= now.getTime() + policy.leadHours * 3_600_000 &&
    startsAt.getTime() <= now.getTime() + policy.horizonDays * 86_400_000;
}
