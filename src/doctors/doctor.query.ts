import { BadRequestException } from '@nestjs/common';

export type DoctorSort = 'name' | 'price_asc' | 'price_desc' | 'rating';
export interface DoctorQuery {
  page: number;
  pageSize: number;
  search: string;
  specialty: string;
  sort: DoctorSort;
}

export function parseDoctorQuery(raw: Record<string, unknown>): DoctorQuery {
  const invalid = () => { throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Tham số tìm kiếm không hợp lệ' }); };
  const integer = (key: string, fallback: number, max: number): number => {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return invalid();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > max) return invalid();
    return number;
  };
  const text = (key: string) => {
    if (raw[key] === undefined) return '';
    if (typeof raw[key] !== 'string' || raw[key].length > 191) return invalid();
    return raw[key].trim();
  };
  const sort = raw.sort ?? 'name';
  if (typeof sort !== 'string' || !['name', 'price_asc', 'price_desc', 'rating'].includes(sort)) invalid();
  return {
    page: integer('page', 1, 1000000), pageSize: integer('pageSize', 10, 50),
    search: text('search'), specialty: text('specialty'), sort: sort as DoctorSort,
  };
}
