import { Module, type DynamicModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from './common/auth/auth.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { EmailModule } from './modules/email/email.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UsageModule } from './modules/usage/usage.module.js';
import { TestOnlyModule } from './common/auth/__test-only__/test-only.module.js';
import { env } from './env.js';

/**
 * Root Nest module.
 *
 * `TestOnlyModule` (the `_test/me` canary used by Playwright) is mounted
 * conditionally — NEVER in production. Spec: auth-foundation R "Protected
 * API Route via JwtAuthGuard" S "Valid token authorizes / Missing → 401".
 *
 * Returns `NonNullable<DynamicModule['imports']>` so the result satisfies
 * `ModuleMetadata.imports` under `exactOptionalPropertyTypes: true` (assigning
 * `T | undefined` to an optional property is rejected). Gating uses the typed
 * `env.NODE_ENV` (validated 'development' | 'test' | 'production') instead of
 * raw `process.env.NODE_ENV`.
 */
function conditionalImports(): NonNullable<DynamicModule['imports']> {
  const base: NonNullable<DynamicModule['imports']> = [
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    HealthModule,
    MembersModule,
    OrganizationsModule,
    EmailModule.forRoot(),
    InvitationsModule,
    SettingsModule,
    UsageModule,
  ];
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    base.push(TestOnlyModule);
  }
  return base;
}

@Module({
  imports: conditionalImports(),
})
export class AppModule {}
