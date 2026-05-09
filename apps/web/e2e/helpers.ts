/**
 * Shared E2E test helpers — `apps/web/e2e/helpers.ts`.
 *
 * `ensureOnboardingComplete` — upserts `Settings.onboardingCompletedAt` for
 * every org the given user belongs to. Must be called after `fakeGoogleSignIn`
 * (and again after `postOrgViaProxy`) in every E2E spec that navigates to a
 * `(dashboard)` route. Without it, the `(dashboard)/layout.tsx` redirect guard
 * (MVP-11) redirects OWNER users with `onboardingCompletedAt = null` to
 * `/onboarding`, breaking all tests that expect to land on `/dashboard` or any
 * sub-route (e.g. `/settings/members`, `/alerts/new`).
 *
 * Why Prisma and not the PATCH proxy?
 *   The PATCH proxy at `/api/org/:orgId/settings` requires knowing the org ID
 *   up-front, which is only reliably available from the DB (the personal org ID
 *   is never surfaced via a public list endpoint). Using Prisma directly matches
 *   the seeding pattern already established in `members.spec.ts` and
 *   `settings-preferences.spec.ts`.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { type PrismaClient, type Prisma } from '@regwatch/db/client';
import { DEFAULT_SETTINGS } from '@regwatch/types';

/**
 * Upserts `Settings.onboardingCompletedAt = now` for every org the user
 * belongs to. Idempotent — safe to call multiple times (e.g. after sign-in
 * AND after creating a new org via `postOrgViaProxy`).
 */
export async function ensureOnboardingComplete(
  prisma: PrismaClient,
  userEmail: string,
): Promise<void> {
  const memberships = await prisma.membership.findMany({
    where: { user: { email: userEmail } },
    select: { organizationId: true },
  });

  for (const { organizationId } of memberships) {
    await prisma.settings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        // Match the same defaults used by SettingsRepo.getOrCreate so the row
        // is valid (jurisdictions is non-nullable in the DB schema).
        jurisdictions: DEFAULT_SETTINGS.jurisdictions as unknown as Prisma.InputJsonValue,
        onboardingCompletedAt: new Date(),
      },
      update: { onboardingCompletedAt: new Date() },
    });
  }
}
