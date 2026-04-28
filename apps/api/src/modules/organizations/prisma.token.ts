/**
 * Re-export of the canonical `PRISMA_CLIENT` token (now homed in
 * `common/prisma/prisma.token.ts` under the global `PrismaModule`).
 *
 * Kept for back-compat so existing `import` paths in this module's
 * source + tests don't churn. New code SHOULD import from
 * `apps/api/src/common/prisma/prisma.token.js` directly.
 */
export { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
