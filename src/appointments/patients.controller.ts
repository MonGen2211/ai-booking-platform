import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { PatientsService } from './patients.service.js';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, ApiValidationErrors, patientSchema } from '../docs/openapi.schemas.js';

@ApiTags('Patient profiles')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('me/patient-profiles')
@UseGuards(AuthGuard)
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}
  @Get()
  @ApiOperation({ summary: 'List my patient profiles' })
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array', items: patientSchema } } } })
  list(@Req() req: AuthenticatedRequest) { return this.patients.list(req.auth!.userId); }

  @Post()
  @ApiOperation({ summary: 'Create a self or relative profile' })
  @ApiBody({ schema: patientSchema })
  @ApiCreatedResponse({ schema: patientSchema })
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.patients.create(req.auth!.userId, body); }
  @Patch(':id')
  @ApiOperation({ summary: 'Update one of my patient profiles' })
  @ApiBody({ schema: patientSchema })
  @ApiOkResponse({ schema: patientSchema })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.patients.update(req.auth!.userId, id, body);
  }
}
