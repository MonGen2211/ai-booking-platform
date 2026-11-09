import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { DoctorsService } from './doctors.service.js';
import { parseDoctorQuery } from './doctor.query.js';

@Controller('doctors')
export class DoctorsController {
  constructor(@Inject(DoctorsService) private readonly doctors: DoctorsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.doctors.list(parseDoctorQuery(query));
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.doctors.detail(id);
  }
}
