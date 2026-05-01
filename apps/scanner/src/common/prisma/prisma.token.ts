/**
 * DI token for the `PrismaClient` singleton inside `apps/scanner`.
 *
 * Mirrors the `apps/api` pattern: `apps/scanner` MUST NOT import
 * `prisma` from `@regwatch/db` directly because `packages/db/src/client.ts`
 * declares `'server-only'` (Next RSC safety marker that throws under
 * tsx/Vitest at module evaluation time). Instead we instantiate a
 * dedicated `PrismaClient` from the `@regwatch/db/client` sub-export.
 *
 * Foot-gun #667 (tsx + NestJS DI): every consumer uses
 * `@Inject(PRISMA_CLIENT)` — class-based interface injection is unreliable
 * under tsx (no `design:paramtypes` emitted by esbuild).
 */
export const PRISMA_CLIENT = Symbol.for('regwatch.scanner.PRISMA_CLIENT');
