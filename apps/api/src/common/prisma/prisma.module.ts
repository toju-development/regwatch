import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@regwatch/db/client';
import { PRISMA_CLIENT } from './prisma.token.js';

/**
 * Lifecycle wrapper for the API-local `PrismaClient` singleton.
 *
 * `apps/api` cannot import the shared `prisma` from `@regwatch/db`
 * because `packages/db/src/client.ts` declares `'server-only'` for
 * Next RSC safety. We instantiate our own client via the
 * `@regwatch/db/client` sub-export.
 *
 * Implements `OnModuleDestroy` so Nest disconnects cleanly on shutdown.
 */
class ApiPrismaClient extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Global Prisma module — single source of `PRISMA_CLIENT` across the
 * api app. Registered once in `app.module.ts`; any module can
 * `@Inject(PRISMA_CLIENT)` without an explicit `imports[]` entry.
 *
 * Lifted out of `OrganizationsModule` in B2 of `sdd/org-members` when
 * `MembersModule` became a second consumer. The original module-local
 * provider would have created two PrismaClient instances; the global
 * boundary preserves a single connection pool.
 *
 * Foot-gun #628: explicit `@Inject(PRISMA_CLIENT)` at every consumer.
 */
@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useClass: ApiPrismaClient }],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule {}
