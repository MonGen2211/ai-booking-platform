import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentsService } from './attachments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';

describe('AttachmentsService', () => {
  it('checks file signature, writes a private random key, and hides it from other users', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appointment-upload-'));
    const previous = process.env.APPOINTMENT_UPLOAD_DIR;
    process.env.APPOINTMENT_UPLOAD_DIR = root;
    const records = new Map<string, any>();
    const prisma = { appointmentAttachment: {
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        const record = { ...data, id: 'a1', appointmentId: null };
        records.set('a1', record);
        return record;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => records.get(where.id)),
    } };
    const service = new AttachmentsService(prisma as unknown as PrismaService, {} as AccessService);
    try {
      await expect(service.upload('u1', { buffer: Buffer.from('bad'), size: 3, originalname: 'x.pdf', mimetype: 'application/pdf' }))
        .rejects.toMatchObject({ status: 400 });
      const bytes = Buffer.from('%PDF-test');
      const result = await service.upload('u1', { buffer: bytes, size: bytes.length, originalname: '../scan.pdf', mimetype: 'application/pdf' });
      expect(result.id).toBe('a1');
      const record = records.get('a1');
      expect(record.storageKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(await readFile(join(root, record.storageKey))).toEqual(bytes);
      await expect(service.download('u2', 'a1')).rejects.toMatchObject({ status: 404 });
      await expect(service.download('u1', 'a1')).resolves.toMatchObject({ buffer: bytes });
      await expect(service.upload('u1', { buffer: bytes, size: 10 * 1024 * 1024 + 1,
        originalname: 'scan.pdf', mimetype: 'application/pdf' })).rejects.toMatchObject({ status: 400 });
    } finally {
      if (previous === undefined) delete process.env.APPOINTMENT_UPLOAD_DIR;
      else process.env.APPOINTMENT_UPLOAD_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans only expired unattached records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appointment-cleanup-'));
    const previous = process.env.APPOINTMENT_UPLOAD_DIR;
    process.env.APPOINTMENT_UPLOAD_DIR = root;
    const expiredKey = '00000000-0000-4000-8000-000000000001';
    const attachedKey = '00000000-0000-4000-8000-000000000002';
    await writeFile(join(root, expiredKey), 'expired');
    await writeFile(join(root, attachedKey), 'attached');
    const prisma = { appointmentAttachment: {
      findMany: vi.fn().mockResolvedValue([{ id: 'expired', storageKey: expiredKey }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const service = new AttachmentsService(prisma as unknown as PrismaService, {} as AccessService);
    try {
      await service.cleanup();
      await expect(readFile(join(root, expiredKey))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(root, attachedKey), 'utf8')).toBe('attached');
      expect(prisma.appointmentAttachment.deleteMany).toHaveBeenCalledWith({ where: { id: 'expired', appointmentId: null } });
    } finally {
      if (previous === undefined) delete process.env.APPOINTMENT_UPLOAD_DIR;
      else process.env.APPOINTMENT_UPLOAD_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});
