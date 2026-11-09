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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly csrfService: CsrfService,
  ) {}

  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.csrfService.bootstrap(request, response);
  }

  @Post('register')
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
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentUser(request.auth!.userId);
  }

  @Post('logout')
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
