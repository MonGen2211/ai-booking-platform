import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DoctorsController } from './doctors.controller.js';
import { DoctorsService } from './doctors.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthExceptionFilter } from '../auth/common/auth-exception.filter.js';

describe('Doctors public API', () => {
  let app: INestApplication;
  const doctor = {
    id: 'doctor-1', name: 'Nguyễn An', specialty: 'Tim mạch', experienceYears: 10,
    consultationFee: new Prisma.Decimal('350000'), address: 'Hà Nội', averageRating: new Prisma.Decimal('4.5'), reviewCount: 2,
  };
  const db = {
    doctor: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((queries: unknown[]) => Promise.all(queries)),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    db.doctor.findMany.mockResolvedValue([doctor]);
    db.doctor.count.mockResolvedValue(1);
    db.doctor.findFirst.mockResolvedValue({ ...doctor, introduction: 'Giới thiệu', qualifications: 'Tiến sĩ' });
    const module = await Test.createTestingModule({
      controllers: [DoctorsController], providers: [DoctorsService, { provide: PrismaService, useValue: db }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
  });
  afterEach(async () => app.close());

  it('filters active profiles and returns a paginated summary without internal fields', async () => {
    const response = await request(app.getHttpServer()).get('/doctors').query({ search: 'An', specialty: 'Tim mạch', page: 2, pageSize: 5, sort: 'price_asc' }).expect(200);
    expect(response.body).toMatchObject({ total: 1, page: 2, pageSize: 5, totalPages: 1, items: [{ consultationFee: '350000.00', averageRating: 4.5 }] });
    expect(db.doctor.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, name: { contains: 'An' }, specialty: 'Tim mạch' }, skip: 5, take: 5,
      orderBy: [{ consultationFee: 'asc' }, { id: 'asc' }],
    }));
    const select = db.doctor.findMany.mock.calls[0][0].select;
    expect(select.isActive).toBeUndefined();
    expect(select.createdAt).toBeUndefined();
  });

  it.each(['price_desc', 'rating', 'name'])('supports stable sorting by %s', async (sort) => {
    await request(app.getHttpServer()).get('/doctors').query({ sort }).expect(200);
    expect(db.doctor.findMany.mock.calls[0][0].orderBy).toEqual([
      sort === 'rating' ? { averageRating: 'desc' } : sort === 'name' ? { name: 'asc' } : { consultationFee: 'desc' }, { id: 'asc' },
    ]);
  });

  it('returns an empty list when no results match or a page is out of range', async () => {
    db.doctor.findMany.mockResolvedValue([]);
    db.doctor.count.mockResolvedValue(0);
    const response = await request(app.getHttpServer()).get('/doctors?page=999').expect(200);
    expect(response.body).toEqual({ items: [], total: 0, page: 999, pageSize: 10, totalPages: 0 });
  });

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'pageSize=51', 'pageSize=0', 'sort=invalid', 'search=a&search=b', 'page=999999999999999999999'])('rejects invalid parameters: %s', async (query) => {
    const response = await request(app.getHttpServer()).get(`/doctors?${query}`).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(db.doctor.findMany).not.toHaveBeenCalled();
  });

  it('returns details only for an active doctor and serializes no rating as null', async () => {
    db.doctor.findFirst.mockResolvedValue({ ...doctor, averageRating: null, introduction: 'Giới thiệu', qualifications: 'Tiến sĩ' });
    const response = await request(app.getHttpServer()).get('/doctors/doctor-1').expect(200);
    expect(response.body).toMatchObject({ introduction: 'Giới thiệu', qualifications: 'Tiến sĩ', averageRating: null });
    expect(db.doctor.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doctor-1', isActive: true } }));
  });

  it('returns 404 for missing or inactive profiles', async () => {
    db.doctor.findFirst.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).get('/doctors/missing').expect(404);
    expect(response.body.code).toBe('DOCTOR_NOT_FOUND');
  });
});
