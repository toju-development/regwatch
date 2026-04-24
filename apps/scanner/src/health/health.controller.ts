import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import type { HealthStatus } from '@regwatch/types';

const SERVICE_VERSION = '0.0.0';

@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'scanner',
      uptime: process.uptime(),
      version: SERVICE_VERSION,
    };
  }
}
