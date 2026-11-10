import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { DoctorsService } from './doctors.service.js';
import { parseDoctorQuery } from './doctor.query.js';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { doctorSchema, errorSchema, paginationSchema } from '../docs/openapi.schemas.js';

@ApiTags('Doctors')
@Controller('doctors')
export class DoctorsController {
  constructor(@Inject(DoctorsService) private readonly doctors: DoctorsService) {}

  @Get()
  @ApiOperation({ summary: 'List active doctors' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 10, description: 'Maximum 50.' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'specialty', required: false, type: String })
  @ApiQuery({ name: 'sort', required: false, enum: ['name', 'price_asc', 'price_desc', 'rating'] })
  @ApiOkResponse({ description: 'Paginated active doctors.', schema: { ...paginationSchema, properties: {
    ...paginationSchema.properties, items: { type: 'array', items: doctorSchema },
  } } })
  list(@Query() query: Record<string, unknown>) {
    return this.doctors.list(parseDoctorQuery(query));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get active doctor details' })
  @ApiOkResponse({ description: 'Doctor profile, price and address.', schema: doctorSchema })
  @ApiNotFoundResponse({ description: 'Doctor missing or inactive.', schema: errorSchema })
  detail(@Param('id') id: string) {
    return this.doctors.detail(id);
  }
}
