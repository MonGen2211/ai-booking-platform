import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\n|\r/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

function utc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  private async appointment(userId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, bookerId: userId,
      status: 'CONFIRMED' }, include: { slot: true } });
    if (!appointment) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Confirmed appointment not found' });
    return appointment;
  }

  async googleLink(userId: string, id: string) {
    const appointment = await this.appointment(userId, id);
    const detailsUrl = `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/appointments/${encodeURIComponent(id)}`;
    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', `Khám với ${appointment.doctorNameSnapshot}`);
    url.searchParams.set('dates', `${utc(appointment.slot.startsAt)}/${utc(appointment.slot.endsAt)}`);
    url.searchParams.set('location', appointment.addressSnapshot);
    url.searchParams.set('details', `Mã lịch: ${appointment.code}\n${detailsUrl}`);
    return { url: url.toString() };
  }

  async ics(userId: string, id: string): Promise<string> {
    const appointment = await this.appointment(userId, id);
    const detailsUrl = `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/appointments/${encodeURIComponent(id)}`;
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Booking//Appointments//VI', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', `UID:${escapeIcs(appointment.id)}@ai-booking.local`, `SEQUENCE:${appointment.version}`,
      `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(appointment.slot.startsAt)}`,
      `DTEND:${utc(appointment.slot.endsAt)}`,
      `SUMMARY:${escapeIcs(`Khám với ${appointment.doctorNameSnapshot}`)}`,
      `LOCATION:${escapeIcs(appointment.addressSnapshot)}`,
      `DESCRIPTION:${escapeIcs(`Mã lịch: ${appointment.code}\n${detailsUrl}`)}`,
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
  }
}
