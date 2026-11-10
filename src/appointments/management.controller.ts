import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { ManagementService } from './management.service.js';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, ApiValidationErrors, appointmentSchema, cancelSchema,
  operationReasonSchema, paginationSchema, rescheduleSchema, versionSchema } from '../docs/openapi.schemas.js';

const appointmentListSchema = { ...paginationSchema, properties: { ...paginationSchema.properties,
  items: { type: 'array' as const, items: appointmentSchema } } };

@ApiTags('My appointments')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('me/appointments')
@UseGuards(AuthGuard)
export class MyAppointmentsController {
  constructor(private readonly management: ManagementService) {}
  @Get()
  @ApiOperation({ summary: 'List my appointments' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 10, description: 'Maximum 50.' })
  @ApiOkResponse({ schema: appointmentListSchema })
  list(@Req() req: AuthenticatedRequest, @Query('status') status: string,
    @Query('page') page: string, @Query('pageSize') pageSize: string) {
    return this.management.ownerList(req.auth!.userId, status, page, pageSize);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get my appointment details' })
  @ApiOkResponse({ schema: appointmentSchema })
  detail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.management.ownerDetail(req.auth!.userId, id);
  }
  @Get(':id/rebook')
  @ApiOperation({ summary: 'Get doctor and patient prefill for rebooking', description: 'Does not create an appointment or copy old symptoms and files.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    doctor: { type: 'object' }, patientProfile: { type: 'object' },
  } } })
  rebook(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.management.rebook(req.auth!.userId, id);
  }
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel my appointment', description: 'Allowed before cancelDeadline. OTHER requires a note.' })
  @ApiBody({ schema: cancelSchema })
  @ApiOkResponse({ schema: appointmentSchema })
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.management.ownerAction(req.auth!.userId, id, 'cancel', body);
  }
  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Move my appointment to another slot', description: 'Keeps the code; the appointment returns to PENDING for approval.' })
  @ApiBody({ schema: rescheduleSchema })
  @ApiOkResponse({ schema: appointmentSchema })
  reschedule(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.management.ownerAction(req.auth!.userId, id, 'reschedule', body);
  }
}

@ApiTags('Appointment operations')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('operations/appointments')
@UseGuards(AuthGuard)
export class OperationsAppointmentsController {
  constructor(private readonly management: ManagementService) {}
  @Get()
  @ApiOperation({ summary: 'List appointments to operate', description: 'Doctor sees only their linked doctor; administrator may filter by doctorId. Defaults to PENDING.' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 10, description: 'Maximum 50.' })
  @ApiQuery({ name: 'doctorId', required: false, type: String })
  @ApiOkResponse({ schema: appointmentListSchema })
  list(@Req() req: AuthenticatedRequest, @Query('status') status: string,
    @Query('page') page: string, @Query('pageSize') pageSize: string, @Query('doctorId') doctorId: string) {
    return this.management.operationList(req.auth!.userId, status, page, pageSize, doctorId);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get appointment details for operations' })
  @ApiOkResponse({ schema: appointmentSchema })
  detail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.management.operationDetail(req.auth!.userId, id);
  }
  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm a pending appointment' })
  @ApiBody({ schema: versionSchema })
  @ApiOkResponse({ schema: appointmentSchema })
  confirm(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.management.operationAction(req.auth!.userId, id, 'confirm', body);
  }
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending appointment', description: 'A reason is required; the slot becomes available again.' })
  @ApiBody({ schema: operationReasonSchema })
  @ApiOkResponse({ schema: appointmentSchema })
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.management.operationAction(req.auth!.userId, id, 'reject', body);
  }
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an appointment as doctor or administrator', description: 'A reason is required.' })
  @ApiBody({ schema: operationReasonSchema })
  @ApiOkResponse({ schema: appointmentSchema })
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.management.operationAction(req.auth!.userId, id, 'cancel', body);
  }
  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark a confirmed appointment completed', description: 'Allowed from the appointment start time.' })
  @ApiBody({ schema: versionSchema })
  @ApiOkResponse({ schema: appointmentSchema })
  complete(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.management.operationAction(req.auth!.userId, id, 'complete', body);
  }
}
