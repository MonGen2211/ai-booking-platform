import { describe, expect, it, vi } from 'vitest';
import { AdminAccessService } from './admin.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AdminAccessService', () => {
  it('refuses to remove the last administrator', async () => {
    const tx = { $queryRaw: vi.fn(), user: { findUnique: vi.fn()
      .mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ role: 'ADMIN', doctorId: null }),
      count: vi.fn().mockResolvedValue(1), update: vi.fn() },
      accessAudit: { create: vi.fn() } };
    const service = new AdminAccessService({ $transaction: (fn: (arg: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService);
    await expect(service.change('admin', 'admin', { role: 'PATIENT' })).rejects.toMatchObject({ status: 409 });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects self-assigned roles outside the protected admin path', async () => {
    const tx = { $queryRaw: vi.fn(), user: { findUnique: vi.fn().mockResolvedValueOnce({ role: 'PATIENT' }) } };
    const service = new AdminAccessService({ $transaction: (fn: (arg: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService);
    await expect(service.change('patient', 'patient', { role: 'ADMIN' })).rejects.toMatchObject({ status: 403 });
  });

  it('writes an audit record for a doctor assignment', async () => {
    const tx = { $queryRaw: vi.fn(), user: { findUnique: vi.fn()
      .mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ role: 'PATIENT', doctorId: null }),
      update: vi.fn().mockResolvedValue({ id: 'u2', role: 'DOCTOR', doctorId: 'd1' }) },
      doctor: { findUnique: vi.fn().mockResolvedValue({ id: 'd1' }) }, accessAudit: { create: vi.fn() } };
    const service = new AdminAccessService({ $transaction: (fn: (arg: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService);
    await expect(service.change('admin', 'u2', { role: 'DOCTOR', doctorId: 'd1' }))
      .resolves.toMatchObject({ role: 'DOCTOR', doctorId: 'd1' });
    expect(tx.accessAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'admin', targetId: 'u2' }) });
  });
});
