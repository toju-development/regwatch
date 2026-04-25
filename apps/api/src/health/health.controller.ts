import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import type { HealthStatus } from '@regwatch/types';
import { Public } from '../common/auth/public.decorator.js';

const SERVICE_VERSION = '0.0.0';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'api',
      uptime: process.uptime(),
      version: SERVICE_VERSION,
    };
  }
}
