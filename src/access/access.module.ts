import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { AccessGuard } from './access.guard.js';
import { AdminController } from './admin.controller.js';
import { AdminAccessService } from './admin.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AccessController, AdminController],
  providers: [AccessService, AccessGuard, AdminAccessService],
  exports: [AccessService, AccessGuard],
})
export class AccessModule {}
