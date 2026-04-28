/**
 * DI token for the shared `PrismaClient` singleton inside `apps/api`.
 *
 * Lifted from `modules/organizations/prisma.token.ts` (B2 of
 * `sdd/org-members`) when a second module — `MembersModule` — needed
 * Prisma. The original token's TODO ("lift this provider into a
 * `@Global()` `PrismaModule`") is now realized here.
 *
 * Foot-gun #628 (tsx + NestJS DI): never rely on TypeScript-class
 * `emitDecoratorMetadata` to wire interface-typed constructor params —
 * always pair `@Inject(TOKEN)` with a `Symbol` provider token.
 *
 * The singleton is provided by `PrismaModule` (`@Global()`), so any
 * module can `@Inject(PRISMA_CLIENT)` without re-importing.
 */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');
