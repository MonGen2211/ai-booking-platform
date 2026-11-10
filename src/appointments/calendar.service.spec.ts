import { describe, expect, it, vi } from 'vitest';
import { CalendarService } from './calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CalendarService', () => {
  it('exports UTC calendar data without symptoms or attachments and escapes text', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'a1', bookerId: 'u1', status: 'CONFIRMED',
      version: 3, code: 'BK-123', doctorNameSnapshot: 'Bác sĩ, A;B', addressSnapshot: 'Clinic, B',
      reason: 'Private reason', symptoms: 'Secret symptom', slot: {
        startsAt: new Date('2026-11-10T02:00:00Z'), endsAt: new Date('2026-11-10T02:30:00Z') } });
    const service = new CalendarService({ appointment: { findFirst } } as unknown as PrismaService);
    const ics = await service.ics('u1', 'a1');
    expect(ics).toContain('DTSTART:20261110T020000Z');
    expect(ics).toContain('DTEND:20261110T023000Z');
    expect(ics).toContain('SEQUENCE:3');
    expect(ics).toContain('Bác sĩ\\, A\\;B');
    expect(ics).not.toContain('Secret symptom');
    expect(ics).not.toContain('Private reason');
    expect(ics.endsWith('\r\n')).toBe(true);
    const link = await service.googleLink('u1', 'a1');
    expect(link.url).toContain('dates=20261110T020000Z%2F20261110T023000Z');
    expect(link.url).not.toContain('Secret symptom');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'a1', bookerId: 'u1', status: 'CONFIRMED' } }));
  });

  it('hides unconfirmed or foreign appointments', async () => {
    const service = new CalendarService({ appointment: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService);
    await expect(service.ics('u2', 'a1')).rejects.toMatchObject({ status: 404 });
  });
});
