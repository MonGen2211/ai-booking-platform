import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { AvailabilityService } from './availability.service.js';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, ApiValidationErrors, scheduleSchema } from '../docs/openapi.schemas.js';

@ApiTags('Availability')
@Controller('doctors/:id')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('schedule') @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiProtectedErrors()
  @ApiOperation({ summary: 'Get doctor working schedule', description: 'Linked doctor or administrator.' })
  @ApiOkResponse({ description: 'Weekly intervals, exceptions and active policy.', schema: scheduleSchema })
  schedule(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.availabilityService.schedule(req.auth!.userId, id);
  }

  @Put('schedule') @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiProtectedErrors()
  @ApiValidationErrors()
  @ApiOperation({ summary: 'Replace doctor working schedule', description: 'Linked doctor or administrator. An occupied slot cannot be removed.' })
  @ApiBody({ schema: scheduleSchema })
  @ApiOkResponse({ description: 'Updated schedule.', schema: scheduleSchema })
  save(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.availabilityService.saveSchedule(req.auth!.userId, id, body);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Get publicly bookable slots' })
  @ApiQuery({ name: 'from', type: String, example: '2026-11-10', description: 'Start date in YYYY-MM-DD, Vietnam timezone.' })
  @ApiQuery({ name: 'to', type: String, example: '2026-11-16', description: 'End date, inclusive; maximum 31 days per request.' })
  @ApiOkResponse({ description: 'Open slots in UTC and the booking policy.', schema: { type: 'object', properties: {
    timezone: { type: 'string' }, policy: { type: 'object' }, items: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' },
    } } },
  } } })
  @ApiValidationErrors()
  slots(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return this.availabilityService.availability(id, from, to);
  }
}
