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

export interface RenameOrgResult {
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

/**
 * Renames the active organization. Called from `<StepOrgName>` in the
 * onboarding wizard when the user modifies the pre-filled org name.
 *
 * Revalidates the full layout so the org name propagates to the header
 * and sidebar immediately after the rename.
 *
 * Spec: `sdd/onboarding-redesign/spec` R-RenameOrg UI.
 * Design: `sdd/onboarding-redesign/design` — renameOrgAction.
 *
 * @param orgId - Active org id.
 * @param name  - New display name (trimmed, 1–80 chars).
 */
export async function renameOrgAction(orgId: string, name: string): Promise<RenameOrgResult> {
  try {
    const res = await apiServerFetch(`/org/${encodeURIComponent(orgId)}`, {
      method: 'PATCH',
      orgId,
      body: { name },
    });
    if (!res.ok) {
      return { ok: false, error: `Request failed (${res.status})` };
    }
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

export interface SaveSettingsResult {
  ok: boolean;
  error?: string;
}

/**
 * Guarda únicamente las jurisdicciones seleccionadas durante el onboarding.
 * Preserva la configuración de cadence existente (hace PUT con los datos
 * que ya tiene el servidor + las nuevas jurisdicciones).
 *
 * Llama primero a GET /org/:orgId/settings para leer la cadence actual,
 * luego hace PUT con los datos fusionados.
 */
export async function saveSettingsAction(
  orgId: string,
  data: {
    jurisdictions: Array<{ code: string; enabled: boolean; customTopics: string }>;
  },
): Promise<SaveSettingsResult> {
  try {
    // Leer la cadence actual para no pisarla.
    const currentRes = await apiServerFetch(`/org/${encodeURIComponent(orgId)}/settings`, {
      method: 'GET',
      orgId,
    });
    if (!currentRes.ok) {
      return {
        ok: false,
        error: `No se pudieron leer las configuraciones actuales (${currentRes.status})`,
      };
    }
    const { settings } = (await currentRes.json()) as {
      settings: {
        scanSchedule: string;
        scanDay: string;
        scanHour: number;
        scanDayOfMonth?: number;
      };
    };

    const res = await apiServerFetch(`/org/${encodeURIComponent(orgId)}/settings`, {
      method: 'PUT',
      orgId,
      body: {
        jurisdictions: data.jurisdictions,
        scanSchedule: settings.scanSchedule,
        scanDay: settings.scanDay,
        scanHour: settings.scanHour,
        ...(settings.scanDayOfMonth !== undefined
          ? { scanDayOfMonth: settings.scanDayOfMonth }
          : {}),
      },
    });
    if (!res.ok) {
      return { ok: false, error: `Error al guardar las jurisdicciones (${res.status})` };
    }
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

export interface SaveSlackChannelResult {
  ok: boolean;
  error?: string;
}

/**
 * Crea el canal de Slack para la organización. Se llama al finalizar el
 * wizard si el usuario ingresó un webhook URL.
 */
export async function saveSlackChannelAction(
  orgId: string,
  webhookUrl: string,
): Promise<SaveSlackChannelResult> {
  try {
    const res = await apiServerFetch('/notifications/channels', {
      method: 'POST',
      orgId,
      body: { provider: 'SLACK', webhookUrl },
    });
    if (!res.ok) {
      return { ok: false, error: `Error al guardar la configuración de Slack (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
