import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthExceptionFilter } from './auth/common/auth-exception.filter.js';
import { DoctorsModule } from './doctors/doctors.module.js';

@Module({
  imports: [PrismaModule, AuthModule, DoctorsModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: AuthExceptionFilter }],
})
export class AppModule {}
