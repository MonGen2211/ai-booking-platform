import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Usage: npm run bootstrap:admin -- existing@example.com');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) throw new Error('Account does not exist; register it first');
  if (user.role !== 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (admins > 0) throw new Error('An admin already exists; use the protected admin API');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN', doctorId: null } });
      await tx.accessAudit.create({ data: { actorId: user.id, targetId: user.id,
        oldRole: user.role, newRole: 'ADMIN', oldDoctorId: null, newDoctorId: null } });
    });
  }
  process.stdout.write(`Admin ready: ${email}\n`);
} finally { await prisma.$disconnect(); }
