/**
 * Component tests for `<NotificationChannelsSection>`.
 *
 * Spec: `sdd/settings-ui-full/spec`
 *   - Notifications Settings Page: channel list renders, empty state.
 *   - Add Notification Channel: provider switch, validation, submit.
 *   - Delete Notification Channel: optimistic removal, error restore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotificationChannelsSection, type ChannelData } from '../notification-channels-section.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHANNEL_SLACK: ChannelData = {
  id: 'ch-1',
  provider: 'SLACK',
  webhookUrl: 'https://hooks.slack.com/services/T123/B456/abc123xyz',
  channelName: null,
  isActive: true,
  jurisdictions: [],
};

const CHANNEL_EMAIL: ChannelData = {
  id: 'ch-2',
  provider: 'EMAIL',
  webhookUrl: null,
  channelName: 'alerts@example.com',
  isActive: true,
  jurisdictions: ['AR', 'BR'],
};

describe('<NotificationChannelsSection>', () => {
  describe('channel list', () => {
    it('renders all channels with provider badge and masked destination', () => {
      render(
        <NotificationChannelsSection channels={[CHANNEL_SLACK, CHANNEL_EMAIL]} orgId="org-1" />,
      );

      expect(screen.getByTestId('channels-list')).toBeInTheDocument();
      expect(screen.getByTestId(`channel-row-${CHANNEL_SLACK.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`channel-row-${CHANNEL_EMAIL.id}`)).toBeInTheDocument();

      // Provider badges
      expect(screen.getByTestId(`channel-row-provider-${CHANNEL_SLACK.id}`)).toHaveTextContent(
        'Slack',
      );
      expect(screen.getByTestId(`channel-row-provider-${CHANNEL_EMAIL.id}`)).toHaveTextContent(
        'Email',
      );

      // Masked destinations — first 8 chars + ***
      expect(screen.getByTestId(`channel-row-destination-${CHANNEL_SLACK.id}`)).toHaveTextContent(
        'https://***',
      );
      expect(screen.getByTestId(`channel-row-destination-${CHANNEL_EMAIL.id}`)).toHaveTextContent(
        'alerts@e***',
      );
    });

    it('shows empty state when there are no channels', () => {
      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      expect(screen.getByTestId('channels-empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('channels-list')).not.toBeInTheDocument();
    });
  });

  describe('delete channel', () => {
    it('optimistically removes channel on delete and calls DELETE API', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      render(<NotificationChannelsSection channels={[CHANNEL_SLACK]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.click(screen.getByTestId(`channel-row-delete-${CHANNEL_SLACK.id}`));

      // Optimistically removed immediately
      await waitFor(() => {
        expect(screen.queryByTestId(`channel-row-${CHANNEL_SLACK.id}`)).not.toBeInTheDocument();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/notifications/channels/${CHANNEL_SLACK.id}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('restores channel and shows error message when DELETE fails', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ message: 'error' }), { status: 500 }),
      );

      render(<NotificationChannelsSection channels={[CHANNEL_SLACK]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.click(screen.getByTestId(`channel-row-delete-${CHANNEL_SLACK.id}`));

      // After API error, channel should reappear
      await waitFor(() => {
        expect(screen.getByTestId(`channel-row-${CHANNEL_SLACK.id}`)).toBeInTheDocument();
      });
      expect(screen.getByTestId('channels-delete-error')).toBeInTheDocument();
    });
  });

  describe('<AddChannelForm>', () => {
    it('shows webhook URL input for SLACK (default)', () => {
      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      expect(screen.getByTestId('add-channel-webhook-url')).toBeInTheDocument();
      expect(screen.queryByTestId('add-channel-email')).not.toBeInTheDocument();
    });

    it('switches to email input when provider=EMAIL is selected', async () => {
      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.selectOptions(screen.getByTestId('add-channel-provider'), 'EMAIL');

      expect(screen.getByTestId('add-channel-email')).toBeInTheDocument();
      expect(screen.queryByTestId('add-channel-webhook-url')).not.toBeInTheDocument();
    });

    it('shows error and does NOT call fetch when webhook URL is empty (SLACK)', async () => {
      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.click(screen.getByTestId('add-channel-submit'));

      expect(screen.getByTestId('add-channel-error')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows error and does NOT call fetch when email is invalid', async () => {
      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.selectOptions(screen.getByTestId('add-channel-provider'), 'EMAIL');
      await user.type(screen.getByTestId('add-channel-email'), 'not-an-email');
      await user.click(screen.getByTestId('add-channel-submit'));

      await screen.findByTestId('add-channel-error');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POSTs to /api/notifications/channels with X-Org-Id and adds to list', async () => {
      const created: ChannelData = {
        id: 'ch-new',
        provider: 'SLACK',
        webhookUrl: 'https://hooks.slack.com/services/X',
        channelName: null,
        isActive: true,
        jurisdictions: [],
      };
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.type(
        screen.getByTestId('add-channel-webhook-url'),
        'https://hooks.slack.com/services/X',
      );
      await user.click(screen.getByTestId('add-channel-submit'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/notifications/channels',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'X-Org-Id': 'org-1' }),
          }),
        );
      });

      // Channel appears in list
      await waitFor(() => {
        expect(screen.getByTestId(`channel-row-${created.id}`)).toBeInTheDocument();
      });
    });

    it('includes selected jurisdictions in POST body', async () => {
      const created: ChannelData = {
        id: 'ch-jur',
        provider: 'SLACK',
        webhookUrl: 'https://hooks.slack.com/services/Y',
        channelName: null,
        isActive: true,
        jurisdictions: ['AR'],
      };
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      render(<NotificationChannelsSection channels={[]} orgId="org-1" />);

      const user = userEvent.setup();
      await user.type(
        screen.getByTestId('add-channel-webhook-url'),
        'https://hooks.slack.com/services/Y',
      );
      await user.click(screen.getByTestId('add-channel-jurisdiction-AR'));
      await user.click(screen.getByTestId('add-channel-submit'));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const callArgs = fetchMock.mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body as string) as { jurisdictions: string[] };
      expect(body.jurisdictions).toContain('AR');
    });
  });
});
