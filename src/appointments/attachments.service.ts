import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';

export type UploadedFile = { buffer: Buffer; size: number; originalname: string; mimetype: string };

const MAX_SIZE = 10 * 1024 * 1024;

function storageRoot(): string {
  return resolve(process.env.APPOINTMENT_UPLOAD_DIR || join(process.cwd(), 'uploads'));
}

function filePath(key: string): string {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
  return join(storageRoot(), key);
}

function mimeFromSignature(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

@Injectable()
export class AttachmentsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  onModuleInit() {
    storageRoot();
    this.timer = setInterval(() => void this.cleanup().catch(() => undefined), 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async upload(ownerId: string, file?: UploadedFile) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.size === 0 || file.size > MAX_SIZE ||
      !file.originalname || file.originalname.length > 255) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid attachment' });
    }
    const mime = mimeFromSignature(file.buffer);
    if (!mime || mime !== file.mimetype) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid attachment type' });
    const key = randomUUID();
    await mkdir(storageRoot(), { recursive: true });
    await writeFile(filePath(key), file.buffer, { flag: 'wx' });
    try {
      const record = await this.prisma.appointmentAttachment.create({ data: {
        ownerId, storageKey: key, originalName: file.originalname, verifiedMime: mime,
        size: file.size, expiresAt: new Date(Date.now() + 24 * 3_600_000),
      }, select: { id: true, originalName: true, verifiedMime: true, size: true, expiresAt: true } });
      return record;
    } catch (error) {
      await unlink(filePath(key)).catch(() => undefined);
      throw error;
    }
  }

  async remove(ownerId: string, id: string) {
    const record = await this.prisma.appointmentAttachment.findFirst({ where: { id, ownerId, appointmentId: null } });
    if (!record) throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found' });
    const deleted = await this.prisma.appointmentAttachment.deleteMany({ where: { id, ownerId, appointmentId: null } });
    if (!deleted.count) throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found' });
    await unlink(filePath(record.storageKey)).catch(() => undefined);
  }

  async download(userId: string, id: string, appointmentId?: string) {
    const record = await this.prisma.appointmentAttachment.findUnique({ where: { id } });
    if (!record || record.appointmentId !== (appointmentId ?? null)) {
      throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found' });
    }
    if (appointmentId) await this.access.requireAppointment(userId, appointmentId);
    else if (record.ownerId !== userId || record.expiresAt <= new Date()) {
      throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found' });
    }
    return { buffer: await readFile(filePath(record.storageKey)), name: record.originalName, mime: record.verifiedMime };
  }

  async cleanup() {
    const expired = await this.prisma.appointmentAttachment.findMany({ where: { appointmentId: null,
      expiresAt: { lte: new Date() } }, select: { id: true, storageKey: true } });
    for (const item of expired) {
      const deleted = await this.prisma.appointmentAttachment.deleteMany({ where: { id: item.id, appointmentId: null } });
      if (deleted.count) await unlink(filePath(item.storageKey)).catch(() => undefined);
    }
  }
}
