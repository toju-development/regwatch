/**
 * `<OnboardingWizard>` — 3-step client stepper for the onboarding flow.
 *
 * Client component (`'use client'`) that manages step state via
 * `useState`. Steps:
 *   0 — Jurisdictions (StepJurisdictions)
 *   1 — Slack Setup   (StepSlack)
 *   2 — Invite Team   (StepInvitations)
 *
 * On final step completion OR skip → calls `completeOnboardingAction(orgId)`
 * then navigates to `/dashboard` via `router.push`.
 *
 * Spec: `sdd/onboarding-flow/spec` — "Three-step client stepper",
 *   "Step indicators MUST show current step position".
 * Design: `sdd/onboarding-flow/design` — onboarding-wizard.tsx (Create).
 *
 * Props are passed from `onboarding/page.tsx` RSC (server-resolved).
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { completeOnboardingAction } from './actions';
import { StepJurisdictions } from './step-jurisdictions';
import { StepSlack } from './step-slack';
import { StepInvitations } from './step-invitations';

import type { PreferencesFormInitial } from '@/components/settings/preferences-form';
import type { NotificationChannelInitial } from '@/components/settings/notification-channel-form';

const TOTAL_STEPS = 3;

export interface OnboardingWizardProps {
  orgId: string;
  initialSettings: PreferencesFormInitial;
  initialChannel: NotificationChannelInitial | null;
}

export function OnboardingWizard({
  orgId,
  initialSettings,
  initialChannel,
}: OnboardingWizardProps): React.ReactElement {
  const [step, setStep] = useState(0);
  const [finishing, startFinish] = useTransition();
  const [finishError, setFinishError] = useState<string | null>(null);
  const router = useRouter();

  function advance(): void {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function handleFinish(): void {
    setFinishError(null);
    startFinish(async () => {
      const result = await completeOnboardingAction(orgId);
      if (!result.ok) {
        setFinishError(result.error ?? 'Failed to complete onboarding. Please try again.');
        return;
      }
      router.push('/dashboard');
    });
  }

  return (
    <div className="flex flex-col gap-8" data-testid="onboarding-wizard">
      {/* Step indicator */}
      <div className="text-muted-foreground text-sm" data-testid="onboarding-wizard-step-indicator">
        Step {step + 1} / {TOTAL_STEPS}
      </div>

      {/* Step dots */}
      <div className="flex gap-2" aria-hidden>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={`h-2 w-8 rounded-full transition-colors ${
              i === step ? 'bg-primary' : 'bg-muted'
            }`}
            data-testid={`onboarding-wizard-dot-${i}`}
          />
        ))}
      </div>

      {/* Active step */}
      {step === 0 && <StepJurisdictions orgId={orgId} initial={initialSettings} onNext={advance} />}
      {step === 1 && <StepSlack orgId={orgId} initialChannel={initialChannel} onNext={advance} />}
      {step === 2 && (
        <StepInvitations orgId={orgId} onFinish={finishing ? () => {} : handleFinish} />
      )}

      {finishing ? (
        <p className="text-muted-foreground text-sm" data-testid="onboarding-wizard-finishing">
          Finishing setup…
        </p>
      ) : null}
      {finishError ? (
        <p
          role="alert"
          className="text-destructive text-sm"
          data-testid="onboarding-wizard-finish-error"
        >
          {finishError}
        </p>
      ) : null}
    </div>
  );
}
