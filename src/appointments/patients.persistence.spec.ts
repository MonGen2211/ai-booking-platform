import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { PatientsService } from './patients.service.js';
import { addDays, vietnamDate } from './policy.js';

describe.runIf(process.env.APPOINTMENT_DATABASE_TEST === 'true')('patient profiles on MySQL', () => {
  it('enforces one self profile and hides another account profile', async () => {
    const prisma = new PrismaService();
    const service = new PatientsService(prisma);
    const ownerId = randomUUID();
    const otherId = randomUUID();
    try {
      await prisma.$connect();
      await prisma.user.createMany({ data: [ownerId, otherId].map((id) => ({ id, email: `${id}@example.test`, passwordHash: 'test' })) });
      const input = { kind: 'SELF', fullName: 'Test patient', birthDate: '2000-01-02', phone: '0123456789' };
      const created = await service.create(ownerId, input);
      expect(created.birthDate).toBe('2000-01-02');
      await expect(service.create(ownerId, input)).rejects.toMatchObject({ status: 409 });
      await expect(service.update(otherId, created.id, { ...input, fullName: 'Other' })).rejects.toMatchObject({ status: 404 });
      await expect(service.create(ownerId, { ...input, kind: 'RELATIVE', relationship: 'Child',
        birthDate: addDays(vietnamDate(new Date()), 1) })).rejects.toMatchObject({ status: 400 });
      expect((await service.list(ownerId)).items).toHaveLength(1);
      expect((await service.list(otherId)).items).toHaveLength(0);
    } finally {
      await prisma.patientProfile.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
      await prisma.$disconnect();
    }
  });
});
