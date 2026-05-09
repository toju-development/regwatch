/**
 * Unit tests for `<NotificationChannelForm>`.
 *
 * Spec: `sdd/onboarding-flow/spec` — NotificationChannelForm:
 *   - Renders webhook URL input and submit button
 *   - Shows existing channel read-only when initialChannel is provided
 *   - Empty URL → inline error, no fetch
 *   - Invalid URL (not https://hooks.slack.com/) → inline error, no fetch
 *   - Valid URL → calls POST /api/notifications/channels with X-Org-Id, shows success
 *   - Upstream non-OK → shows error message from response body
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotificationChannelForm } from '../notification-channel-form.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<NotificationChannelForm>', () => {
  it('renders the webhook URL input and submit button', () => {
    render(<NotificationChannelForm orgId="org-1" initialChannel={null} />);

    expect(screen.getByTestId('notification-channel-form')).toBeInTheDocument();
    expect(screen.getByTestId('notification-channel-form-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('notification-channel-form-submit')).toBeInTheDocument();
  });

  it('shows existing channel as read-only when initialChannel is provided', () => {
    render(
      <NotificationChannelForm
        orgId="org-1"
        initialChannel={{ webhookUrl: 'https://hooks.slack.com/services/existing' }}
      />,
    );

    expect(screen.getByTestId('notification-channel-form-existing-url')).toHaveTextContent(
      'https://hooks.slack.com/…',
    );
    expect(screen.queryByTestId('notification-channel-form-url-input')).not.toBeInTheDocument();
  });

  it('shows error and does NOT call fetch when URL is empty', async () => {
    const user = userEvent.setup();
    render(<NotificationChannelForm orgId="org-1" initialChannel={null} />);

    await user.click(screen.getByTestId('notification-channel-form-submit'));

    expect(screen.getByTestId('notification-channel-form-error')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows error when URL does not start with https://hooks.slack.com/', async () => {
    const user = userEvent.setup();
    render(<NotificationChannelForm orgId="org-1" initialChannel={null} />);

    await user.type(
      screen.getByTestId('notification-channel-form-url-input'),
      'https://example.com/webhook',
    );
    await user.click(screen.getByTestId('notification-channel-form-submit'));

    expect(screen.getByTestId('notification-channel-form-error')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to /api/notifications/channels with X-Org-Id and shows success', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    render(<NotificationChannelForm orgId="org-1" initialChannel={null} />);

    await user.type(
      screen.getByTestId('notification-channel-form-url-input'),
      'https://hooks.slack.com/services/T000/B000/xxx',
    );
    await user.click(screen.getByTestId('notification-channel-form-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/notifications/channels');
    expect((init as RequestInit).method).toBe('POST');
    const headers = new Headers((init as RequestInit).headers as HeadersInit);
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');

    await waitFor(() => {
      expect(screen.getByTestId('notification-channel-form-success')).toBeInTheDocument();
    });
  });

  it('shows error message from response body when fetch returns non-OK', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    render(<NotificationChannelForm orgId="org-1" initialChannel={null} />);

    await user.type(
      screen.getByTestId('notification-channel-form-url-input'),
      'https://hooks.slack.com/services/T000/B000/yyy',
    );
    await user.click(screen.getByTestId('notification-channel-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-channel-form-error')).toHaveTextContent(
        'already exists',
      );
    });
  });
});
