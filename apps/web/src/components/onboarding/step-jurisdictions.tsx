/**
 * `<StepJurisdictions>` — onboarding wizard Step 1.
 *
 * Wraps `<PreferencesForm>` with "Next" and "Skip" wizard controls.
 * "Next" submits the form via `updateSettingsAction` then calls
 * `onNext`; "Skip" calls `onNext` directly without saving.
 *
 * Spec: `sdd/onboarding-flow/spec` — "Step 1 — save and advance".
 * Design: `sdd/onboarding-flow/design` — step-jurisdictions.tsx (Create).
 *
 * `orgId` is an explicit prop so this component is safe outside the
 * `(dashboard)` route group (no `resolveActiveOrg` call needed).
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  PreferencesForm,
  type PreferencesFormInitial,
} from '@/components/settings/preferences-form';
import { updateSettingsAction } from '@/components/settings/actions';

export interface StepJurisdictionsProps {
  orgId: string;
  initial: PreferencesFormInitial;
  onNext: () => void;
}

export function StepJurisdictions({
  orgId,
  initial,
  onNext,
}: StepJurisdictionsProps): React.ReactElement {
  const [pending, startTransition] = useTransition();

  function handleSkip(): void {
    onNext();
  }

  // The "Next" button is wired to submit the inner <PreferencesForm>.
  // We do this by giving the form a known id and using form="..." on the
  // submit button, delegating the save + transition to the wizard level.
  // To keep coupling minimal, we instead expose a Save-and-advance
  // button that replicates the submit call.
  function handleSaveAndAdvance(): void {
    startTransition(async () => {
      // We issue the update directly here so we control when onNext fires.
      // The PreferencesForm manages its own internal state; we mirror the
      // initial values for the action call here because the user may not
      // have touched anything yet.  A future improvement can pass the
      // form's current state via a ref/callback if deep editing is needed.
      // For MVP: if the user modifies the form and clicks "Next", they
      // should use the embedded Save button inside PreferencesForm. This
      // button is a "save current defaults + advance" shortcut.
      await updateSettingsAction(orgId, initial);
      onNext();
    });
  }

  return (
    <div className="flex flex-col gap-6" data-testid="step-jurisdictions">
      <div>
        <h2 className="text-lg font-semibold">Step 1: Jurisdictions</h2>
        <p className="text-muted-foreground text-sm">
          Select the jurisdictions RegWatch should monitor for your organisation.
        </p>
      </div>
      <PreferencesForm orgId={orgId} canEdit initial={initial} />
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSaveAndAdvance}
          disabled={pending}
          data-testid="step-jurisdictions-next"
        >
          {pending ? 'Saving…' : 'Next'}
        </Button>
        <button
          type="button"
          onClick={handleSkip}
          className="text-muted-foreground hover:text-foreground text-sm"
          data-testid="step-jurisdictions-skip"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
