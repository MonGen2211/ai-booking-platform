import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseDateOnly, vietnamDate } from './policy.js';
import type { PatientKind } from '../generated/prisma/enums.js';

function invalid(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

function parseProfile(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Invalid patient profile');
  const item = body as Record<string, unknown>;
  if (item.kind !== 'SELF' && item.kind !== 'RELATIVE') return invalid('Invalid patient kind');
  if (typeof item.fullName !== 'string' || !item.fullName.trim() || item.fullName.trim().length > 191) return invalid('Invalid full name');
  if (typeof item.phone !== 'string' || !/^\+?[0-9\s()-]{7,32}$/.test(item.phone.trim())) return invalid('Invalid phone');
  const birthDate = parseDateOnly(item.birthDate);
  if (birthDate > vietnamDate(new Date())) return invalid('Birth date is in the future');
  if (item.kind === 'RELATIVE' && (typeof item.relationship !== 'string' || !item.relationship.trim() || item.relationship.trim().length > 64)) {
    return invalid('Relationship is required');
  }
  return { kind: item.kind as PatientKind, fullName: item.fullName.trim(), phone: item.phone.trim(),
    birthDate: new Date(`${birthDate}T00:00:00.000Z`), relationship: item.kind === 'RELATIVE' ? String(item.relationship).trim() : null };
}

function view<T extends { birthDate: Date }>(profile: T) {
  return { ...profile, birthDate: profile.birthDate.toISOString().slice(0, 10) };
}

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string) {
    const items = await this.prisma.patientProfile.findMany({ where: { ownerId }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
    return { items: items.map(view) };
  }

  async create(ownerId: string, body: unknown) {
    const input = parseProfile(body);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${ownerId} FOR UPDATE`;
      if (input.kind === 'SELF' && await tx.patientProfile.count({ where: { ownerId, kind: 'SELF' } })) {
        throw new ConflictException({ code: 'SELF_PROFILE_EXISTS', message: 'Self profile already exists' });
      }
      return view(await tx.patientProfile.create({ data: { ownerId, ...input } }));
    });
  }

  async update(ownerId: string, id: string, body: unknown) {
    const input = parseProfile(body);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${ownerId} FOR UPDATE`;
      const profile = await tx.patientProfile.findFirst({ where: { id, ownerId } });
      if (!profile) throw new NotFoundException({ code: 'PROFILE_NOT_FOUND', message: 'Patient profile not found' });
      if (input.kind === 'SELF' && profile.kind !== 'SELF' && await tx.patientProfile.count({ where: { ownerId, kind: 'SELF' } })) {
        throw new ConflictException({ code: 'SELF_PROFILE_EXISTS', message: 'Self profile already exists' });
      }
      return view(await tx.patientProfile.update({ where: { id }, data: input }));
    });
  }
}
