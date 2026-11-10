import { Body, Controller, Get, Param, Patch, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/common/auth.types.js';
import { ACCESS_RULE, AccessGuard } from './access.guard.js';
import { AdminAccessService } from './admin.service.js';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { accessSchema, ApiProtectedErrors, ApiValidationErrors } from '../docs/openapi.schemas.js';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@ApiProtectedErrors()
@ApiValidationErrors()
@Controller('admin/users')
@UseGuards(AuthGuard, AccessGuard)
@SetMetadata(ACCESS_RULE, 'admin')
export class AdminController {
  constructor(private readonly admin: AdminAccessService) {}

  @Get()
  @ApiOperation({ summary: 'Find a user by exact email', description: 'Administrator only.' })
  @ApiQuery({ name: 'email', type: String, example: 'doctor@example.com' })
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } } } })
  find(@Query('email') email: string) { return this.admin.find(email); }

  @Patch(':id/access')
  @ApiOperation({ summary: 'Assign role and doctor link', description: 'Administrator only. The last administrator cannot be demoted.' })
  @ApiBody({ schema: accessSchema })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    id: { type: 'string' }, role: { type: 'string' }, doctorId: { type: 'string', nullable: true },
  } } })
  change(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.change(request.auth!.userId, id, body);
  }
}
