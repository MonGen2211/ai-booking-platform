import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Explicit opt-in: these tests use the MySQL connection in backend/.env.
describe.runIf(process.env.DOCTOR_DATABASE_TEST === 'true')('Doctors API with MySQL', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  const marker = `doctor-e2e-${randomUUID()}`;
  const ids = ['a', 'b', 'c', 'd', 'inactive', 'other'].map((suffix) => `${marker}-${suffix}`);
  const specialty = `Tim mạch ${marker}`;
  const common = {
    specialty, introduction: 'Giới thiệu bác sĩ kiểm thử', qualifications: 'Bác sĩ chuyên khoa',
    experienceYears: 8, address: 'Địa chỉ kiểm thử',
  };
  const list = (query: Record<string, string | number> = {}) =>
    request(app!.getHttpServer()).get('/doctors').query({ search: marker, ...query });
  const itemIds = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.doctor.createMany({ data: [
      { ...common, id: ids[0], name: `${marker} Nguyễn An`, consultationFee: '250000.50', averageRating: '4.6', reviewCount: 8 },
      { ...common, id: ids[1], name: `${marker} Trần Bình`, consultationFee: '300000.00', averageRating: '4.9', reviewCount: 12 },
      { ...common, id: ids[2], name: `${marker} Lê Chi`, consultationFee: '150000.00', averageRating: null, reviewCount: 0 },
      { ...common, id: ids[3], name: `${marker} Phạm Dung`, consultationFee: '250000.50', averageRating: '4.6', reviewCount: 3 },
      { ...common, id: ids[4], name: `${marker} Nguyễn Ẩn`, consultationFee: '10000.00', averageRating: '5.0', reviewCount: 20, isActive: false },
      { ...common, id: ids[5], name: `${marker} Nguyễn Em`, specialty: `Nội khoa ${marker}`, consultationFee: '100000.00', averageRating: '4.8', reviewCount: 4 },
    ] });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        // Exact fixture IDs only; never remove existing doctor records.
        await prisma.doctor.deleteMany({ where: { id: { in: ids } } });
        expect(await prisma.doctor.count({ where: { id: { in: ids } } })).toBe(0);
      }
    } finally {
      await app?.close();
    }
  });

  it('paginates filtered data with deterministic ordering and an accurate total', async () => {
    const expectedPages = [[ids[5], ids[2]], [ids[0], ids[3]], [ids[1]]];
    for (let page = 1; page <= expectedPages.length; page++) {
      const response = await list({ sort: 'price_asc', page, pageSize: 2 }).expect(200);
      expect(response.body).toMatchObject({ total: 5, page, pageSize: 2, totalPages: 3 });
      expect(itemIds(response.body)).toEqual(expectedPages[page - 1]);
    }
    const beyond = await list({ page: 4, pageSize: 2 }).expect(200);
    expect(beyond.body).toMatchObject({ items: [], total: 5, page: 4, totalPages: 3 });
  });

  it('combines a Vietnamese name search and exact specialty filter', async () => {
    const response = await list({ search: `${marker} Nguyễn`, specialty }).expect(200);
    expect(itemIds(response.body)).toEqual([ids[0]]);
    expect(response.body.total).toBe(1);

    const empty = await list({ specialty: `Không tồn tại ${marker}` }).expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('sorts prices in both directions without changing decimal precision', async () => {
    const ascending = await list({ sort: 'price_asc', specialty }).expect(200);
    expect(itemIds(ascending.body)).toEqual([ids[2], ids[0], ids[3], ids[1]]);
    expect(ascending.body.items.map((item: { consultationFee: string }) => item.consultationFee))
      .toEqual(['150000.00', '250000.50', '250000.50', '300000.00']);

    const descending = await list({ sort: 'price_desc', specialty }).expect(200);
    expect(itemIds(descending.body)).toEqual([ids[1], ids[0], ids[3], ids[2]]);
  });

  it('sorts ratings highest first with unrated profiles last and stable ties', async () => {
    const response = await list({ sort: 'rating' }).expect(200);
    expect(itemIds(response.body)).toEqual([ids[1], ids[5], ids[0], ids[3], ids[2]]);
    expect(response.body.items.map((item: { averageRating: number | null }) => item.averageRating))
      .toEqual([4.9, 4.8, 4.6, 4.6, null]);
    expect(itemIds(response.body)).not.toContain(ids[4]);
  });

  it('returns the persisted detail without exposing internal fields', async () => {
    const response = await request(app!.getHttpServer()).get(`/doctors/${ids[0]}`).expect(200);
    expect(response.body).toEqual({
      id: ids[0], name: `${marker} Nguyễn An`, specialty,
      introduction: common.introduction, qualifications: common.qualifications,
      experienceYears: common.experienceYears, address: common.address,
      consultationFee: '250000.50', averageRating: 4.6, reviewCount: 8,
    });
  });

  it('returns the same 404 for inactive and missing profiles', async () => {
    for (const id of [ids[4], `${marker}-missing`]) {
      const response = await request(app!.getHttpServer()).get(`/doctors/${id}`).expect(404);
      expect(response.body).toEqual({ code: 'DOCTOR_NOT_FOUND', message: 'Không tìm thấy bác sĩ' });
    }
  });

  it('rejects invalid pagination and unsupported sorting', async () => {
    for (const query of [{ page: 0 }, { pageSize: 51 }, { sort: 'unsupported' }]) {
      const response = await list(query).expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });
});
