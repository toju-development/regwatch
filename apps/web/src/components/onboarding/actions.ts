/**
 * Server actions for the onboarding wizard.
 *
 * Spec: `sdd/onboarding-flow/spec` — "Step 3 — finish wizard",
 *   "Skip all from layout header".
 * Design: `sdd/onboarding-flow/design` — `components/onboarding/actions.ts`
 *   (Create; `completeOnboardingAction` marks onboarding complete via
 *   `PATCH /org/:orgId/settings { onboardingCompletedAt: <ISO> }`).
 *
 * Architecture: mirrors `components/settings/actions.ts` posture.
 *   - Calls `apiServerFetch` (direct; no self-HTTP hop).
 *   - Returns `{ ok, error? }` — redirect is the CALLER'S responsibility
 *     (client component uses `router.push`).
 *   - `revalidatePath('/onboarding')` on success so the RSC guard
 *     (which checks `onboardingCompletedAt`) does not re-run the wizard
 *     on a back-navigation.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use server';

import { revalidatePath } from 'next/cache';

import { apiServerFetch, ApiServerUnauthenticatedError } from '@/lib/api-server';

export interface CompleteOnboardingResult {
  ok: boolean;
  error?: string;
}

/**
 * Marks onboarding as complete by PATCHing the org settings with the
 * current server timestamp. The caller is responsible for navigating to
 * `/dashboard` on success.
 *
 * @param orgId - Active org id (resolved server-side by the RSC and
 *                passed down as a prop to `<OnboardingWizard>`).
 */
export async function completeOnboardingAction(orgId: string): Promise<CompleteOnboardingResult> {
  try {
    const res = await apiServerFetch(`/org/${encodeURIComponent(orgId)}/settings`, {
      method: 'PATCH',
      orgId,
      body: { onboardingCompletedAt: new Date().toISOString() },
    });
    if (!res.ok) {
      return { ok: false, error: `Request failed (${res.status})` };
    }
    revalidatePath('/onboarding');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
