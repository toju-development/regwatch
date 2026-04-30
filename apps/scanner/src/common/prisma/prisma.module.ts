/**
 * Lifecycle wrapper for the scanner-local `PrismaClient` singleton.
 *
 * `apps/scanner` cannot import the shared `prisma` from `@regwatch/db`
 * because `packages/db/src/client.ts` declares `'server-only'` for Next
 * RSC safety — that marker throws under tsx/Vitest at module evaluation.
 * We instantiate via the `@regwatch/db/client` sub-export instead, which
 * exports the generated `PrismaClient` class without the marker.
 *
 * `@Global()` so any module can `@Inject(PRISMA_CLIENT)` without an
 * explicit `imports[]` entry — single connection pool process-wide.
 *
 * Mirrors `apps/api/src/common/prisma/prisma.module.ts`.
 */
import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@regwatch/db/client';

import { PRISMA_CLIENT } from './prisma.token.js';

class ScannerPrismaClient extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useClass: ScannerPrismaClient }],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule {}
