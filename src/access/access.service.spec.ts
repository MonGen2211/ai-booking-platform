import { describe, expect, it, vi } from 'vitest';
import { AccessService } from './access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AccessService', () => {
  it('applies a revoked role on the next request even with the same user id', async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ role: 'DOCTOR', doctorId: 'd1' })
      .mockResolvedValueOnce({ role: 'PATIENT', doctorId: null });
    const service = new AccessService({ user: { findUnique } } as unknown as PrismaService);
    await expect(service.requireDoctor('u1', 'd1')).resolves.toBeUndefined();
    await expect(service.requireDoctor('u1', 'd1')).rejects.toMatchObject({ status: 404 });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('allows admins for every doctor and hides another doctor from a doctor account', async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ role: 'ADMIN', doctorId: null })
      .mockResolvedValueOnce({ role: 'DOCTOR', doctorId: 'd1' });
    const service = new AccessService({ user: { findUnique } } as unknown as PrismaService);
    await expect(service.requireDoctor('admin', 'd2')).resolves.toBeUndefined();
    await expect(service.requireDoctor('doctor', 'd2')).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a booking private from another account', async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ role: 'PATIENT', doctorId: null }) },
      appointment: { findUnique: vi.fn().mockResolvedValue({ bookerId: 'u1', doctorId: 'd1' }) } };
    const service = new AccessService(prisma as unknown as PrismaService);
    await expect(service.requireAppointment('u2', 'a1')).rejects.toMatchObject({ status: 404 });
  });
});
