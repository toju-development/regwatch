/**
 * `<StepJurisdictions>` — onboarding wizard Step 1.
 *
 * Wraps `<PreferencesForm>` with "Next" and "Skip" wizard controls.
 * "Next" submits the inner `<PreferencesForm>` natively — the browser
 * wires `<button form="step-preferences-form">` to the form, so all
 * user edits are captured before the server action fires. On success
 * the form calls `onNext` via the `onSuccess` callback.
 * "Skip" calls `onNext` directly without saving.
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

import { Button } from '@/components/ui/button';
import {
  PreferencesForm,
  type PreferencesFormInitial,
} from '@/components/settings/preferences-form';

const FORM_ID = 'step-preferences-form';

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
  return (
    <div className="flex flex-col gap-6" data-testid="step-jurisdictions">
      <div>
        <h2 className="text-lg font-semibold">Step 1: Jurisdictions</h2>
        <p className="text-muted-foreground text-sm">
          Select the jurisdictions RegWatch should monitor for your organisation.
        </p>
      </div>
      <PreferencesForm
        orgId={orgId}
        canEdit
        initial={initial}
        formId={FORM_ID}
        onSuccess={onNext}
      />
      <div className="flex items-center gap-3">
        {/* type="submit" + form="..." lets the browser submit the inner
            PreferencesForm natively — no JS glue needed. */}
        <Button type="submit" form={FORM_ID} data-testid="step-jurisdictions-next">
          Next
        </Button>
        <button
          type="button"
          onClick={onNext}
          className="text-muted-foreground hover:text-foreground text-sm"
          data-testid="step-jurisdictions-skip"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
