import { Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@regwatch/db/client';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService, defaultSlugGenerator } from './organizations.service.js';
import { ORG_REPO_TOKEN, PrismaOrgRepo } from './org.repo.js';
import { PRISMA_CLIENT } from './prisma.token.js';

/**
 * Lifecycle wrapper for the API-local `PrismaClient` singleton.
 *
 * `apps/api` cannot import the shared `prisma` from `@regwatch/db` because
 * `packages/db/src/client.ts` declares `'server-only'` for Next RSC safety
 * (verified: throws on `import` from any non-`react-server` runtime, incl.
 * tsx + Vitest). We instantiate our own client via the `@regwatch/db/client`
 * sub-export (added in this slice — see B1 progress notes).
 *
 * Implements `OnModuleDestroy` so Nest disconnects cleanly on shutdown.
 */
class ApiPrismaClient extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * `OrganizationsModule` — mounts `/org` controller, wires the Prisma-backed
 * repository behind an explicit `@Inject(ORG_REPO_TOKEN)` boundary
 * (foot-gun #628 — tsx + NestJS DI requires explicit tokens for
 * interface-typed deps).
 *
 * Slug generator is provided as a value (not a factory) — overrideable in
 * tests via `Test.createTestingModule().overrideProvider(...)`.
 *
 * Spec: `sdd/org-membership-ux/spec` R-Org-GetMe + R-OrgCreate.
 * Design: `sdd/org-membership-ux/design` §1, §2.
 */
@Module({
  controllers: [OrganizationsController],
  providers: [
    { provide: PRISMA_CLIENT, useClass: ApiPrismaClient },
    { provide: ORG_REPO_TOKEN, useClass: PrismaOrgRepo },
    {
      provide: OrganizationsService,
      useFactory: (repo: PrismaOrgRepo): OrganizationsService =>
        new OrganizationsService(repo, defaultSlugGenerator),
      inject: [ORG_REPO_TOKEN],
    },
  ],
})
export class OrganizationsModule {}
