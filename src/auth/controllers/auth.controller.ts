import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { parseCredentials } from '../dto/auth.dto.js';
import { AuthGuard } from '../guards/auth.guard.js';
import type { AuthenticatedRequest } from '../common/auth.types.js';
import { appendRefreshCookie, clearRefreshCookie, readCookie } from '../security/auth.cookies.js';
import { CsrfService } from '../security/csrf.service.js';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiNoContentResponse, ApiOkResponse,
  ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiProtectedErrors, credentialsSchema, errorSchema } from '../../docs/openapi.schemas.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly csrfService: CsrfService,
  ) {}

  @Get('csrf')
  @ApiOperation({ summary: 'Get CSRF token and cookie', description: 'Requires Origin to match FRONTEND_ORIGIN. Send the returned token as X-CSRF-Token and keep the csrf_token cookie for register/login/logout.' })
  @ApiHeader({ name: 'Origin', description: 'Configured frontend origin.', required: true })
  @ApiOkResponse({ schema: { type: 'object', properties: { csrfToken: { type: 'string' } } } })
  @ApiResponse({ status: 403, description: 'Origin not allowed.', schema: errorSchema })
  @HttpCode(HttpStatus.OK)
  csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.csrfService.bootstrap(request, response);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a patient account', description: 'Requires configured Origin, CSRF cookie and X-CSRF-Token header. Returns access JWT in X-Access-Token response header and refresh JWT in an HttpOnly cookie.' })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ schema: credentialsSchema })
  @ApiResponse({ status: 201, description: 'Account and session created.', schema: { type: 'object', properties: {
    id: { type: 'string' }, email: { type: 'string', format: 'email' }, createdAt: { type: 'string', format: 'date-time' },
  } } })
  @ApiResponse({ status: 409, description: 'Email already exists.', schema: errorSchema })
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.csrfService.validate(request);
    const issued = await this.authService.register(parseCredentials(body));
    appendRefreshCookie(response, request, issued.refreshToken);
    response.setHeader('X-Access-Token', issued.accessToken);
    return issued.user;
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in', description: 'Requires configured Origin, CSRF cookie and X-CSRF-Token header. Access JWT is returned in X-Access-Token; refresh JWT is an HttpOnly cookie.' })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ schema: credentialsSchema })
  @ApiOkResponse({ description: 'Current user and new session.', schema: { type: 'object', properties: {
    id: { type: 'string' }, email: { type: 'string', format: 'email' }, createdAt: { type: 'string', format: 'date-time' },
  } } })
  @ApiResponse({ status: 401, description: 'Invalid credentials.', schema: errorSchema })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.csrfService.validate(request);
    const issued = await this.authService.login(parseCredentials(body));
    appendRefreshCookie(response, request, issued.refreshToken);
    response.setHeader('X-Access-Token', issued.accessToken);
    return issued.user;
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiProtectedErrors()
  @ApiOperation({ summary: 'Get the authenticated user', description: 'An expired access token may be refreshed using the refresh cookie when Origin and CSRF requirements are met.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    id: { type: 'string' }, email: { type: 'string', format: 'email' }, createdAt: { type: 'string', format: 'date-time' },
  } } })
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentUser(request.auth!.userId);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Log out current session', description: 'Requires configured Origin, CSRF cookie and X-CSRF-Token header; access token or refresh cookie identifies the session.' })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBearerAuth('access-token')
  @ApiNoContentResponse({ description: 'Session revoked; refresh cookie cleared.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.csrfService.validate(request);
    const accessToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    await this.authService.logoutWithTokens(
      accessToken,
      readCookie(request, 'refresh_token'),
    );
    clearRefreshCookie(request, response);
  }
}
