import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  @Get()
  @ApiOperation({ summary: 'Health greeting' })
  @ApiOkResponse({ description: 'Plain-text service greeting.', schema: { type: 'string' } })
  getHello(): string { return this.appService.getHello(); }
}
