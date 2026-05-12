/**
 * `<NotificationChannelsSection>` — settings UI for managing notification
 * channels post-onboarding.
 *
 * Spec: `sdd/settings-ui-full/spec` — Notifications Settings Page,
 *   Add Notification Channel, Delete Notification Channel.
 * Design: `sdd/settings-ui-full/design` — NotificationChannelsSection.
 *
 * Compound component structure:
 *   NotificationChannelsSection (manages optimistic list state)
 *     ├── ChannelRow × N  (DELETE via proxy)
 *     └── AddChannelForm  (POST via proxy)
 *
 * Mutations go through the web proxy routes:
 *   POST   /api/notifications/channels
 *   DELETE /api/notifications/channels/[id]
 *
 * `X-Org-Id` is set directly on every fetch so the proxy can forward it
 * to the upstream API's OrgScopeGuard. This mirrors the `apiFetch`
 * wrapper pattern used in onboarding (no Zustand dependency — this is a
 * settings page, not the onboarding wizard).
 */
'use client';

import { useState } from 'react';
import { JURISDICTIONS, type JurisdictionCode } from '@regwatch/types';

import { Button } from '@/components/ui/button';

export interface ChannelData {
  id: string;
  provider: 'SLACK' | 'TEAMS' | 'EMAIL';
  webhookUrl?: string | null;
  channelName?: string | null;
  isActive: boolean;
  jurisdictions: string[];
}

export interface NotificationChannelsSectionProps {
  channels: ChannelData[];
  orgId: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function maskDestination(channel: ChannelData): string {
  const raw = channel.webhookUrl ?? channel.channelName ?? '';
  if (!raw) return '—';
  if (raw.length <= 8) return raw;
  return `${raw.slice(0, 8)}***`;
}

function providerLabel(provider: ChannelData['provider']): string {
  switch (provider) {
    case 'SLACK':
      return 'Slack';
    case 'TEAMS':
      return 'Teams';
    case 'EMAIL':
      return 'Email';
  }
}

// ─── ChannelRow ───────────────────────────────────────────────────────────────

interface ChannelRowProps {
  channel: ChannelData;
  orgId: string;
  onDelete: (id: string) => void;
  onDeleteError: (id: string, channel: ChannelData) => void;
}

function ChannelRow({
  channel,
  orgId,
  onDelete,
  onDeleteError,
}: ChannelRowProps): React.ReactElement {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    onDelete(channel.id); // optimistic removal
    try {
      const res = await fetch(`/api/notifications/channels/${encodeURIComponent(channel.id)}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      });
      if (!res.ok) {
        onDeleteError(channel.id, channel); // restore
      }
    } catch {
      onDeleteError(channel.id, channel); // restore on network error
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li
      className="flex items-center justify-between rounded-md border px-4 py-3"
      data-testid={`channel-row-${channel.id}`}
    >
      <div className="flex flex-col gap-0.5">
        <span
          className="text-xs font-medium uppercase tracking-wide text-blue-600"
          data-testid={`channel-row-provider-${channel.id}`}
        >
          {providerLabel(channel.provider)}
        </span>
        <span className="font-mono text-sm" data-testid={`channel-row-destination-${channel.id}`}>
          {maskDestination(channel)}
        </span>
        {channel.jurisdictions.length > 0 ? (
          <span className="text-muted-foreground text-xs">{channel.jurisdictions.join(', ')}</span>
        ) : (
          <span className="text-muted-foreground text-xs">All jurisdictions</span>
        )}
      </div>
      <Button
        variant="outline"
        className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
        size="sm"
        disabled={deleting}
        onClick={() => void handleDelete()}
        data-testid={`channel-row-delete-${channel.id}`}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </Button>
    </li>
  );
}

// ─── AddChannelForm ───────────────────────────────────────────────────────────

interface AddChannelFormProps {
  orgId: string;
  onAdded: (channel: ChannelData) => void;
}

function AddChannelForm({ orgId, onAdded }: AddChannelFormProps): React.ReactElement {
  const [provider, setProvider] = useState<ChannelData['provider']>('SLACK');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [email, setEmail] = useState('');
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<Set<JurisdictionCode>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWebhookProvider = provider === 'SLACK' || provider === 'TEAMS';

  function toggleJurisdiction(code: JurisdictionCode): void {
    setSelectedJurisdictions((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function validate(): string | null {
    if (isWebhookProvider) {
      if (!webhookUrl.trim()) return 'Webhook URL is required.';
    } else {
      if (!email.trim()) return 'Email address is required.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Invalid email address.';
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        provider,
        webhookUrl: isWebhookProvider ? webhookUrl.trim() : undefined,
        channelName: !isWebhookProvider ? email.trim() : undefined,
        jurisdictions: Array.from(selectedJurisdictions),
      };
      const res = await fetch('/api/notifications/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': orgId,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? 'Failed to add channel.');
        return;
      }
      const created = (await res.json()) as ChannelData;
      onAdded(created);
      // Reset
      setWebhookUrl('');
      setEmail('');
      setSelectedJurisdictions(new Set());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border p-4"
      data-testid="add-channel-form"
    >
      <h3 className="text-sm font-medium">Add channel</h3>

      <div className="flex flex-col gap-1">
        <label htmlFor="add-channel-provider" className="text-sm font-medium">
          Provider
        </label>
        <select
          id="add-channel-provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ChannelData['provider']);
            setError(null);
          }}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm sm:max-w-xs"
          data-testid="add-channel-provider"
        >
          <option value="SLACK">Slack</option>
          <option value="TEAMS">Teams</option>
          <option value="EMAIL">Email</option>
        </select>
      </div>

      {isWebhookProvider ? (
        <div className="flex flex-col gap-1" data-testid="add-channel-webhook-wrap">
          <label htmlFor="add-channel-webhook-url" className="text-sm font-medium">
            Webhook URL
          </label>
          <input
            id="add-channel-webhook-url"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            data-testid="add-channel-webhook-url"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1" data-testid="add-channel-email-wrap">
          <label htmlFor="add-channel-email" className="text-sm font-medium">
            Email address
          </label>
          <input
            id="add-channel-email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alerts@example.com"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            data-testid="add-channel-email"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Jurisdictions (empty = catch-all)</span>
        <div className="flex flex-wrap gap-3" data-testid="add-channel-jurisdictions">
          {JURISDICTIONS.map((j) => (
            <label key={j.code} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={selectedJurisdictions.has(j.code)}
                onChange={() => toggleJurisdiction(j.code)}
                data-testid={`add-channel-jurisdiction-${j.code}`}
              />
              {j.code}
            </label>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm" data-testid="add-channel-error">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={submitting}
        data-testid="add-channel-submit"
        className="self-start"
      >
        {submitting ? 'Adding…' : 'Add channel'}
      </Button>
    </form>
  );
}

// ─── NotificationChannelsSection ──────────────────────────────────────────────

export function NotificationChannelsSection({
  channels: initialChannels,
  orgId,
}: NotificationChannelsSectionProps): React.ReactElement {
  const [channels, setChannels] = useState<ChannelData[]>(initialChannels);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete(id: string): void {
    setDeleteError(null);
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  function handleDeleteError(id: string, channel: ChannelData): void {
    // Restore the channel that failed to delete
    void id;
    setChannels((prev) => [...prev, channel]);
    setDeleteError('Failed to delete channel. Please try again.');
  }

  function handleAdded(channel: ChannelData): void {
    setChannels((prev) => [...prev, channel]);
  }

  return (
    <section className="flex flex-col gap-6" data-testid="notification-channels-section">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-muted-foreground text-sm">
          Notifications are sent to these channels when alerts match your configured jurisdictions.
        </p>
      </div>

      {deleteError ? (
        <p role="alert" className="text-destructive text-sm" data-testid="channels-delete-error">
          {deleteError}
        </p>
      ) : null}

      {channels.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="channels-empty-state">
          No notification channels configured. Add one below.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="channels-list">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              orgId={orgId}
              onDelete={handleDelete}
              onDeleteError={handleDeleteError}
            />
          ))}
        </ul>
      )}

      <AddChannelForm orgId={orgId} onAdded={handleAdded} />
    </section>
  );
}
