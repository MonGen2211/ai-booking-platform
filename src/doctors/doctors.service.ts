import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { DoctorQuery } from './doctor.query.js';

const summarySelect = {
  id: true, name: true, specialty: true, experienceYears: true,
  consultationFee: true, address: true, averageRating: true, reviewCount: true,
} satisfies Prisma.DoctorSelect;

type Summary = Prisma.DoctorGetPayload<{ select: typeof summarySelect }>;
function serialize<T extends Summary>(doctor: T) {
  return { ...doctor, consultationFee: doctor.consultationFee.toFixed(2), averageRating: doctor.averageRating?.toNumber() ?? null };
}

@Injectable()
export class DoctorsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: DoctorQuery) {
    const where: Prisma.DoctorWhereInput = {
      isActive: true,
      ...(query.search ? { name: { contains: query.search } } : {}),
      ...(query.specialty ? { specialty: query.specialty } : {}),
    };
    const orderBy: Prisma.DoctorOrderByWithRelationInput[] = query.sort === 'rating'
      ? [{ averageRating: 'desc' }, { id: 'asc' }]
      : query.sort === 'price_asc' || query.sort === 'price_desc'
        ? [{ consultationFee: query.sort === 'price_asc' ? 'asc' : 'desc' }, { id: 'asc' }]
        : [{ name: 'asc' }, { id: 'asc' }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.doctor.findMany({ where, select: summarySelect, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.doctor.count({ where }),
    ]);
    return { items: items.map(serialize), total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) };
  }

  async detail(id: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id, isActive: true },
      select: { ...summarySelect, introduction: true, qualifications: true },
    });
    if (!doctor) throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: 'Không tìm thấy bác sĩ' });
    return serialize(doctor);
  }
}
