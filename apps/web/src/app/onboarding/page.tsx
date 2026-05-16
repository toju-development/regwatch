/**
 * Onboarding page — redirige al dashboard.
 *
 * El flujo de onboarding ahora se muestra como modal sobre el dashboard.
 * Esta page existe solo para compatibilidad con posibles bookmarks o
 * links externos a `/onboarding`.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { redirect } from 'next/navigation';

export default function OnboardingPage(): never {
  redirect('/dashboard');
}
