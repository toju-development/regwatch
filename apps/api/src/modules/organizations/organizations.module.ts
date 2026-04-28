import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService, defaultSlugGenerator } from './organizations.service.js';
import { ORG_REPO_TOKEN, PrismaOrgRepo } from './org.repo.js';

/**
 * `OrganizationsModule` — mounts `/org` controller, wires the Prisma-backed
 * repository behind an explicit `@Inject(ORG_REPO_TOKEN)` boundary
 * (foot-gun #628 — tsx + NestJS DI requires explicit tokens for
 * interface-typed deps).
 *
 * The `PrismaClient` singleton is no longer provided here — it lives in
 * `apps/api/src/common/prisma/prisma.module.ts` (`@Global()`) since B2
 * of `sdd/org-members`, where `MembersModule` became a second consumer.
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
