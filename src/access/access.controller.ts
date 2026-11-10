import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { AccessService } from './access.service.js';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors } from '../docs/openapi.schemas.js';

@ApiTags('Access')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@Controller('me')
@UseGuards(AuthGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('capabilities')
  @ApiOperation({ summary: 'Get current role and linked doctor' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    role: { type: 'string', enum: ['PATIENT', 'DOCTOR', 'ADMIN'] },
    doctorId: { type: 'string', nullable: true }, canManageAll: { type: 'boolean' },
    canManageDoctor: { type: 'boolean' },
  } } })
  capabilities(@Req() request: AuthenticatedRequest) {
    return this.access.capabilities(request.auth!.userId);
  }
}
