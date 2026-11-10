import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { CalendarService } from './calendar.service.js';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, ApiValidationErrors } from '../docs/openapi.schemas.js';

@ApiTags('Calendar')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('me/appointments/:id')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar-link')
  @ApiOperation({ summary: 'Get Google Calendar prefilled link', description: 'Owner only; appointment must be CONFIRMED. No Google account integration.' })
  @ApiOkResponse({ schema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } } })
  link(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.calendar.googleLink(req.auth!.userId, id);
  }

  @Get('calendar.ics')
  @ApiOperation({ summary: 'Download appointment ICS file', description: 'Owner only; appointment must be CONFIRMED.' })
  @ApiOkResponse({ description: 'Text calendar file.', content: {
    'text/calendar': { schema: { type: 'string', format: 'binary' } },
  } })
  async ics(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res() res: Response) {
    const body = await this.calendar.ics(req.auth!.userId, id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="appointment.ics"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
  }
}
