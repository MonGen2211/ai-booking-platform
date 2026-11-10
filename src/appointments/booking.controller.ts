import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { BookingService } from './booking.service.js';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, ApiValidationErrors, appointmentSchema, bookingSchema } from '../docs/openapi.schemas.js';

@ApiTags('Booking')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('appointments')
@UseGuards(AuthGuard)
export class BookingController {
  constructor(private readonly booking: BookingService) {}
  @Post()
  @ApiOperation({ summary: 'Book an available slot', description: 'Creates a PENDING appointment. Reuse the same Idempotency-Key and body after a lost response; a taken slot returns 409 with up to five suggestions.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique key (8–191 characters) for one booking request.' })
  @ApiBody({ schema: bookingSchema })
  @ApiCreatedResponse({ description: 'Appointment code, status and deadlines.', schema: appointmentSchema })
  create(@Req() req: AuthenticatedRequest, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return this.booking.create(req.auth!.userId, key, body);
  }
}
