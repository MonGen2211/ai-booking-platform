import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './controllers/auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { CsrfService } from './security/csrf.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, CsrfService],
  exports: [AuthService, AuthGuard, CsrfService, JwtModule],
})
export class AuthModule {}
