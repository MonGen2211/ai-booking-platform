import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const details =
        body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const code = typeof details.code === 'string' ? details.code : codeForStatus(status);
      const message =
        status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Authentication service is temporarily unavailable'
          : typeof details.message === 'string'
            ? details.message
            : exception.message;

      response.status(status).json({ code, message,
        ...(Array.isArray(details.suggestions) ? { suggestions: details.suggestions } : {}) });
      return;
    }

    if (exception instanceof Error && exception.name === 'MulterError') {
      response.status(HttpStatus.BAD_REQUEST).json({ code: 'VALIDATION_ERROR', message: 'Invalid attachment' });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  }
}
