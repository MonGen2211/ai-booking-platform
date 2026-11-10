import { describe, expect, it } from 'vitest';
import { bookingPolicy, bookingWindow, parseDateOnly, parseSchedule, vietnamDate, vietnamInstant } from './policy.js';

describe('appointment policy', () => {
  it('converts Vietnam wall time to an exact UTC instant without host timezone', () => {
    const date = vietnamInstant('2026-11-10', 9 * 60);
    expect(date.toISOString()).toBe('2026-11-10T02:00:00.000Z');
    expect(vietnamDate(date)).toBe('2026-11-10');
  });

  it('rejects overlapping weekly and exceptional intervals', () => {
    const base = { weekday: 1, effectiveFrom: '2026-11-09', startMinute: 540, endMinute: 600, durationMinutes: 30 };
    expect(() => parseSchedule({ weekly: [base, { ...base, startMinute: 590, endMinute: 650 }], exceptions: [] })).toThrow();
    expect(() => parseSchedule({ weekly: [], exceptions: [{ date: '2026-11-09', isClosed: false,
      intervals: [{ startMinute: 540, endMinute: 600, durationMinutes: 30 }, { startMinute: 590, endMinute: 650, durationMinutes: 30 }] }] })).toThrow();
  });

  it('accepts closed exceptions and refuses non-calendar dates', () => {
    expect(parseSchedule({ weekly: [], exceptions: [{ date: '2026-11-09', isClosed: true }] }).exceptions[0].intervals).toEqual([]);
    expect(() => parseDateOnly('2026-02-30')).toThrow();
  });

  it('rejects an inconsistent configuration', () => {
    const previous = process.env.BOOKING_SLOT_MINUTES;
    process.env.BOOKING_SLOT_MINUTES = '17';
    try { expect(() => bookingPolicy()).toThrow(); } finally {
      if (previous === undefined) delete process.env.BOOKING_SLOT_MINUTES;
      else process.env.BOOKING_SLOT_MINUTES = previous;
    }
  });

  it('limits booking to the lead time and horizon', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    expect(bookingWindow(new Date('2026-11-09T01:59:59Z'), now)).toBe(false);
    expect(bookingWindow(new Date('2026-11-09T02:00:00Z'), now)).toBe(true);
    expect(bookingWindow(new Date('2027-01-09T00:00:00Z'), now)).toBe(false);
  });
});
