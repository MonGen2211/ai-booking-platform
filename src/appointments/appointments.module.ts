import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';
import { AttachmentsService } from './attachments.service.js';
import { AppointmentAttachmentsController, MyAttachmentsController } from './attachments.controller.js';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { ManagementService } from './management.service.js';
import { MyAppointmentsController, OperationsAppointmentsController } from './management.controller.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({ imports: [AuthModule, AccessModule], controllers: [AvailabilityController, PatientsController,
  MyAttachmentsController, AppointmentAttachmentsController, BookingController,
  MyAppointmentsController, OperationsAppointmentsController, CalendarController],
  providers: [AvailabilityService, PatientsService, AttachmentsService, BookingService, ManagementService, CalendarService],
  exports: [AvailabilityService, PatientsService, AttachmentsService, BookingService, ManagementService, CalendarService] })
export class AppointmentsModule {}
