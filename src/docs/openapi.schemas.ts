import { applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse,
  ApiUnauthorizedResponse } from '@nestjs/swagger';

const string = { type: 'string' as const };
const integer = { type: 'integer' as const };
const date = { type: 'string' as const, format: 'date' };
const dateTime = { type: 'string' as const, format: 'date-time' };

export const errorSchema = { type: 'object' as const, required: ['code', 'message'], properties: {
  code: string, message: string,
} };

export const credentialsSchema = { type: 'object' as const, required: ['email', 'password'], properties: {
  email: { type: 'string' as const, format: 'email', example: 'patient@example.com' },
  password: { type: 'string' as const, minLength: 8, format: 'password', example: 'secret123' },
} };

export const accessSchema = { type: 'object' as const, required: ['role'], properties: {
  role: { type: 'string' as const, enum: ['PATIENT', 'DOCTOR', 'ADMIN'] },
  doctorId: { ...string, nullable: true, description: 'Required when role is DOCTOR; otherwise omit or null.' },
} };

export const intervalSchema = { type: 'object' as const,
  required: ['startMinute', 'endMinute', 'durationMinutes'], properties: {
    startMinute: { ...integer, minimum: 0, maximum: 1439, example: 540 },
    endMinute: { ...integer, minimum: 1, maximum: 1440, example: 720 },
    durationMinutes: { ...integer, minimum: 5, maximum: 240, example: 30 },
  } };

export const scheduleSchema = { type: 'object' as const, required: ['weekly', 'exceptions'], properties: {
  weekly: { type: 'array' as const, items: { type: 'object' as const,
    required: [...intervalSchema.required, 'weekday', 'effectiveFrom'], properties: {
      ...intervalSchema.properties,
      weekday: { ...integer, minimum: 0, maximum: 6, description: '0 = Sunday', example: 1 },
      effectiveFrom: date, effectiveTo: { ...date, nullable: true },
    } } },
  exceptions: { type: 'array' as const, items: { type: 'object' as const,
    required: ['date', 'isClosed'], properties: {
      date, isClosed: { type: 'boolean' as const },
      intervals: { type: 'array' as const, items: intervalSchema },
    } } },
} };

export const patientSchema = { type: 'object' as const,
  required: ['kind', 'fullName', 'birthDate', 'phone'], properties: {
    kind: { type: 'string' as const, enum: ['SELF', 'RELATIVE'] },
    fullName: { ...string, maxLength: 191, example: 'Nguyễn Văn A' },
    birthDate: date,
    phone: { ...string, example: '0901234567' },
    relationship: { ...string, description: 'Required for RELATIVE.' },
  } };

export const bookingSchema = { type: 'object' as const,
  required: ['slotId', 'profileId', 'reason', 'attachmentIds', 'acceptedDetails'], properties: {
    slotId: string, profileId: string, reason: { ...string, maxLength: 2000 },
    symptoms: { ...string, maxLength: 4000, nullable: true },
    attachmentIds: { type: 'array' as const, maxItems: 5, items: string },
    acceptedDetails: { type: 'object' as const, required: ['consultationFee', 'address'], properties: {
      consultationFee: { ...string, example: '250000.00' }, address: string,
    } },
  } };

export const cancelSchema = { type: 'object' as const, required: ['expectedVersion', 'reason'], properties: {
  expectedVersion: { ...integer, minimum: 1 },
  reason: { type: 'string' as const, enum: ['CHANGE_PLANS', 'HEALTH_CHANGED', 'BOOKED_WRONG', 'OTHER'] },
  note: { ...string, maxLength: 1000, description: 'Required when reason is OTHER.' },
} };

export const operationReasonSchema = { type: 'object' as const, required: ['expectedVersion', 'reason'], properties: {
  expectedVersion: { ...integer, minimum: 1 }, reason: { ...string, maxLength: 1000 },
} };

export const versionSchema = { type: 'object' as const, required: ['expectedVersion'], properties: {
  expectedVersion: { ...integer, minimum: 1 },
} };

export const rescheduleSchema = { type: 'object' as const, required: ['expectedVersion', 'newSlotId'], properties: {
  expectedVersion: { ...integer, minimum: 1 }, newSlotId: string,
} };

export const appointmentSchema = { type: 'object' as const, properties: {
  id: string, code: string,
  status: { type: 'string' as const, enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] },
  version: integer, doctorId: string, doctorName: string, address: string,
  consultationFee: string, startsAt: dateTime, endsAt: dateTime,
  timezone: string, patient: { type: 'object' as const }, reason: string,
  symptoms: { ...string, nullable: true }, policy: { type: 'object' as const },
  cancelDeadline: dateTime, rescheduleDeadline: dateTime,
  allowedActions: { type: 'object' as const, additionalProperties: { type: 'boolean' as const } },
  attachments: { type: 'array' as const, items: { type: 'object' as const, properties: {
    id: string, originalName: string, verifiedMime: string, size: integer,
  } } },
  events: { type: 'array' as const, items: { type: 'object' as const } },
} };

export const doctorSchema = { type: 'object' as const, properties: {
  id: string, name: string, specialty: string, introduction: string,
  qualifications: string, experienceYears: integer, consultationFee: string,
  address: string, averageRating: { type: 'number' as const, nullable: true },
  reviewCount: integer,
} };

export const paginationSchema = { type: 'object' as const, properties: {
  total: integer, page: integer, pageSize: integer, totalPages: integer,
} };

export function ApiProtectedErrors() {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Access token or session is missing or invalid.', schema: errorSchema }),
    ApiForbiddenResponse({ description: 'Insufficient role or invalid Origin/CSRF.', schema: errorSchema }),
  );
}

export function ApiValidationErrors() {
  return applyDecorators(
    ApiBadRequestResponse({ description: 'Invalid request data.', schema: errorSchema }),
    ApiConflictResponse({ description: 'Slot, policy, version or idempotency conflict.', schema: errorSchema }),
    ApiNotFoundResponse({ description: 'Resource not found or outside the caller’s scope.', schema: errorSchema }),
  );
}
