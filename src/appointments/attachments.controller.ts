import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { AttachmentsService, type UploadedFile as Upload } from './attachments.service.js';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiNoContentResponse,
  ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, ApiValidationErrors } from '../docs/openapi.schemas.js';

function sendFile(response: Response, file: { buffer: Buffer; name: string; mime: string }) {
  response.setHeader('Content-Type', file.mime);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  response.send(file.buffer);
}

@ApiTags('Attachments')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('me/attachments')
@UseGuards(AuthGuard)
export class MyAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post() @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  @ApiOperation({ summary: 'Upload a temporary private attachment', description: 'One JPEG, PNG or PDF up to 10 MiB. Unattached files expire after 24 hours.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiCreatedResponse({ schema: { type: 'object', properties: {
    id: { type: 'string' }, originalName: { type: 'string' }, verifiedMime: { type: 'string' },
    size: { type: 'integer' }, expiresAt: { type: 'string', format: 'date-time' },
  } } })
  upload(@Req() req: AuthenticatedRequest, @UploadedFile() file?: Upload) {
    return this.attachments.upload(req.auth!.userId, file);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete my unattached temporary file' })
  @ApiNoContentResponse()
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.attachments.remove(req.auth!.userId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Download my temporary file' })
  @ApiOkResponse({ description: 'Private file download.', content: {
    'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
  } })
  async download(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res() res: Response) {
    sendFile(res, await this.attachments.download(req.auth!.userId, id));
  }
}

@ApiTags('Attachments')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('appointments/:id/attachments')
@UseGuards(AuthGuard)
export class AppointmentAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get(':attachmentId')
  @ApiOperation({ summary: 'Download a file attached to an appointment', description: 'Owner, linked doctor or administrator.' })
  @ApiOkResponse({ description: 'Private file download.', content: {
    'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
  } })
  async download(@Req() req: AuthenticatedRequest, @Param('id') id: string,
    @Param('attachmentId') attachmentId: string, @Res() res: Response) {
    sendFile(res, await this.attachments.download(req.auth!.userId, attachmentId, id));
  }
}
