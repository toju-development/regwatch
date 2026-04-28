/**
 * NextAuth `events.signOut` side effect: clear the active-org cookie.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-ActiveOrgCookie scenario
 *   "Sign-out clears cookie".
 * Design: `sdd/org-membership-ux/design` §3 (cookie lifecycle).
 *
 * Extracted to its own module (rather than inlined in `auth.ts`) so the
 * sign-out side effect is unit-testable WITHOUT booting NextAuth — the
 * spec contract is "the active-org cookie MUST be deleted in the same
 * response that clears the NextAuth session". Importing `auth.ts`
 * pulls in Prisma, env validation, and providers — too heavy for a
 * focused contract test.
 *
 * The function is `async` because Next 15 `cookies()` is async; it is
 * intentionally void-returning so it can be passed directly as the
 * NextAuth `events.signOut` handler:
 *
 *   events: {
 *     signOut: clearActiveOrgOnSignOut,
 *   }
 *
 * NextAuth invokes `events.signOut` from a server action / route
 * handler context, which is the only place Next 15 allows cookie
 * mutations — `clearActiveOrgIdCookie()` will succeed there and throw
 * loudly elsewhere (by design).
 */
import 'server-only';

import { clearActiveOrgIdCookie } from './active-org-cookie.js';

export async function clearActiveOrgOnSignOut(): Promise<void> {
  await clearActiveOrgIdCookie();
}
