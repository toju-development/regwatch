import { Module } from '@nestjs/common';
import { AuthModule } from './common/auth/auth.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [AuthModule, HealthModule],
})
export class AppModule {}
