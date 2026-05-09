/**
 * `<StepSlack>` — onboarding wizard Step 2.
 *
 * Wraps `<NotificationChannelForm>` with "Next" and "Skip" wizard controls.
 * Both advance to the next step — the Slack setup is optional.
 *
 * Spec: `sdd/onboarding-flow/spec` — "Step 2 — skip without saving".
 * Design: `sdd/onboarding-flow/design` — step-slack.tsx (Create).
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { Button } from '@/components/ui/button';
import {
  NotificationChannelForm,
  type NotificationChannelInitial,
} from '@/components/settings/notification-channel-form';

export interface StepSlackProps {
  orgId: string;
  initialChannel: NotificationChannelInitial | null;
  onNext: () => void;
}

export function StepSlack({ orgId, initialChannel, onNext }: StepSlackProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-6" data-testid="step-slack">
      <div>
        <h2 className="text-lg font-semibold">Step 2: Slack Notifications</h2>
        <p className="text-muted-foreground text-sm">
          Connect a Slack channel to receive regulatory alerts. You can skip this and set it up
          later in settings.
        </p>
      </div>
      <NotificationChannelForm orgId={orgId} initialChannel={initialChannel} />
      <div className="flex items-center gap-3">
        <Button onClick={onNext} data-testid="step-slack-next">
          Next
        </Button>
        <button
          type="button"
          onClick={onNext}
          className="text-muted-foreground hover:text-foreground text-sm"
          data-testid="step-slack-skip"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
