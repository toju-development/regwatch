/**
 * `<StepInvitations>` — onboarding wizard Step 3 (final).
 *
 * Wraps `<InviteMemberForm>` with "Finish" and "Skip & Finish" controls.
 * Both call `onFinish` which triggers `completeOnboardingAction` in the
 * parent wizard.
 *
 * Spec: `sdd/onboarding-flow/spec` — "Step 3 — finish wizard".
 * Design: `sdd/onboarding-flow/design` — step-invitations.tsx (Create).
 *
 * The viewer in the onboarding context is always an OWNER (only OWNERs
 * are redirected to the wizard), so `viewerRole` is hardcoded to 'OWNER'.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { Button } from '@/components/ui/button';
import { InviteMemberForm } from '@/components/members/invite-member-form';

export interface StepInvitationsProps {
  orgId: string;
  onFinish: () => void;
}

export function StepInvitations({ orgId, onFinish }: StepInvitationsProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-6" data-testid="step-invitations">
      <div>
        <h2 className="text-lg font-semibold">Step 3: Invite your team</h2>
        <p className="text-muted-foreground text-sm">
          Invite team members to collaborate on regulatory monitoring. You can skip this and manage
          members in settings.
        </p>
      </div>
      <InviteMemberForm orgId={orgId} viewerRole="OWNER" />
      <div className="flex items-center gap-3">
        <Button onClick={onFinish} data-testid="step-invitations-finish">
          Finish
        </Button>
        <button
          type="button"
          onClick={onFinish}
          className="text-muted-foreground hover:text-foreground text-sm"
          data-testid="step-invitations-skip"
        >
          Skip &amp; Finish
        </button>
      </div>
    </div>
  );
}
