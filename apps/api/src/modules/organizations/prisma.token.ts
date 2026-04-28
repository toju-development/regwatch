/**
 * DI token for the shared `PrismaClient` singleton inside `apps/api`.
 *
 * Foot-gun #628 (tsx + NestJS DI): never rely on TypeScript-class
 * `emitDecoratorMetadata` to wire interface-typed constructor params —
 * always pair `@Inject(TOKEN)` with a `Symbol` provider token.
 *
 * The singleton is provided by `OrganizationsModule` (the only consumer
 * today). When a second module needs Prisma, lift this provider into a
 * `@Global()` `PrismaModule` and re-export the token.
 */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');
