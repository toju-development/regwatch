/**
 * `<NotificationChannelForm>` — POST-only Slack webhook configuration form.
 *
 * Spec: `sdd/onboarding-flow/spec` — NotificationChannelForm:
 *   - POST-only; no edit/PATCH mode.
 *   - Client-side URL validation before submit.
 *   - Success state shown inline on completion.
 *   - Standalone: importable outside onboarding (future POST-5 settings UI).
 *
 * Design: `sdd/onboarding-flow/design` — `notification-channel-form.tsx`
 *   (Create). POSTs to `/api/notifications/channels` (Next.js proxy).
 *   Uses raw `fetch` with `X-Org-Id` header set from prop — NOT `apiFetch`
 *   because this component renders OUTSIDE `<ActiveOrgProvider>` (no
 *   Zustand hydration in the onboarding flow).
 *
 * If `initialChannel` is provided, displays existing webhookUrl as
 * read-only with a note — does NOT send a PATCH (out of scope).
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

/** Wire shape from `GET /notifications/channels` (subset). */
export interface NotificationChannelInitial {
  webhookUrl: string;
  channelName?: string | null;
}

export interface NotificationChannelFormProps {
  /** Org under which to create the channel (used as `X-Org-Id` header). */
  orgId: string;
  /**
   * If a Slack channel already exists for this org, pass it here.
   * The form will show it as read-only rather than showing the input.
   * No PATCH is sent (POST-only spec constraint).
   */
  initialChannel: NotificationChannelInitial | null;
}

const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/';

function isValidSlackWebhookUrl(url: string): boolean {
  return url.startsWith(SLACK_WEBHOOK_PREFIX);
}

export function NotificationChannelForm({
  orgId,
  initialChannel,
}: NotificationChannelFormProps): React.ReactElement {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // If a channel already exists, show it read-only.
  if (initialChannel && !successMsg) {
    return (
      <div
        className="flex flex-col gap-3 rounded-md border p-4"
        data-testid="notification-channel-form"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Slack webhook</p>
          <p className="text-muted-foreground text-xs">
            A Slack webhook is already configured for this organisation.
          </p>
        </div>
        <p
          className="bg-muted truncate rounded px-3 py-2 text-sm"
          data-testid="notification-channel-form-existing-url"
        >
          {initialChannel.webhookUrl}
        </p>
      </div>
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrorMsg(null);
    const trimmed = webhookUrl.trim();
    if (!trimmed) {
      setErrorMsg('Enter a Slack Incoming Webhook URL.');
      return;
    }
    if (!isValidSlackWebhookUrl(trimmed)) {
      setErrorMsg(`URL must start with "${SLACK_WEBHOOK_PREFIX}".`);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/notifications/channels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Org-Id': orgId,
          },
          body: JSON.stringify({ provider: 'SLACK', webhookUrl: trimmed }),
        });
        if (!res.ok) {
          let message = `Request failed (${res.status})`;
          try {
            const body = (await res.json()) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            /* non-JSON */
          }
          setErrorMsg(message);
          return;
        }
        setSuccessMsg('Slack webhook saved successfully.');
        setWebhookUrl('');
      } catch {
        setErrorMsg('Network error — please try again.');
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border p-4"
      data-testid="notification-channel-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="notification-channel-webhook-url" className="text-sm font-medium">
          Slack Incoming Webhook URL
        </label>
        <p className="text-muted-foreground text-xs">
          Paste the webhook URL from your Slack app configuration.
        </p>
      </div>
      <input
        id="notification-channel-webhook-url"
        type="url"
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
        disabled={pending}
        placeholder="https://hooks.slack.com/services/..."
        className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        data-testid="notification-channel-form-url-input"
      />
      <Button type="submit" disabled={pending} data-testid="notification-channel-form-submit">
        {pending ? 'Saving…' : 'Save webhook'}
      </Button>
      {errorMsg ? (
        <p
          role="alert"
          className="text-destructive text-sm"
          data-testid="notification-channel-form-error"
        >
          {errorMsg}
        </p>
      ) : null}
      {successMsg ? (
        <p
          role="status"
          className="text-muted-foreground text-sm"
          data-testid="notification-channel-form-success"
        >
          {successMsg}
        </p>
      ) : null}
    </form>
  );
}
