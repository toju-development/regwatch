/**
 * DI tokens for `UsageModule` (MVP-5 B6).
 *
 * Foot-gun #667 (tsx + NestJS DI): the `tsx`/esbuild transformer does NOT
 * emit `design:paramtypes` metadata, so interface-typed constructor params
 * cannot be resolved by class. Every consumer pairs `@Inject(TOKEN)` with
 * one of these symbols.
 *
 * - {@link USAGE_REPO_TOKEN}: persistence boundary for the usage module
 *   (`UsageRepo`). The module wires `PrismaUsageRepo` against this token;
 *   tests rebind via `useValue` for vi-mocked repos.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth, R-12-UsageReadEndpoint.
 * Design: `sdd/scanner-vertical-ar/design` ADR-11 (Usage module in apps/api),
 *   ADR-15 (DI tokens / chokepoint trust).
 */
export const USAGE_REPO_TOKEN = Symbol('USAGE_REPO_TOKEN');
