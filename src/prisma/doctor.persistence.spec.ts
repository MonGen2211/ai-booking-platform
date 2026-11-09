import { describe, expect, it } from 'vitest';
import { PrismaService } from './prisma.service.js';

describe.runIf(process.env.DOCTOR_DATABASE_TEST === 'true')('Doctor persistence (local MySQL)', () => {
  it('persists active and inactive profiles without leaving test data', async () => {
    const prisma = new PrismaService();
    const rollback = new Error('ROLLBACK_DOCTOR_FIXTURES');
    try {
      await expect(prisma.$transaction(async (tx) => {
        const data = {
          name: 'Bác sĩ kiểm thử', specialty: 'Nội tổng quát',
          introduction: 'Hồ sơ kiểm thử', qualifications: 'Bác sĩ',
          experienceYears: 5, consultationFee: '250000.00', address: 'Địa chỉ kiểm thử',
        };
        const active = await tx.doctor.create({ data });
        const inactive = await tx.doctor.create({ data: { ...data, isActive: false } });
        const profiles = await tx.doctor.findMany({ where: { id: { in: [active.id, inactive.id] } } });
        expect(profiles).toHaveLength(2);
        expect(active.consultationFee.toString()).toBe('250000');
        const visible = await tx.doctor.findMany({ where: { id: { in: [active.id, inactive.id] }, isActive: true } });
        expect(visible.map((doctor) => doctor.id)).toEqual([active.id]);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  });
});
