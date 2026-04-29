/**
 * RSC tests for `/accept/[token]/page.tsx`.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Preview (anonymous fetch — display-safe fields only).
 *   - R-Invitation-Accept (3 branches: error / sign-in / accept).
 *   - R-Public-Routes (page must render without a session).
 *
 * Strategy: invoke the async server component as a function, then render
 * the returned JSX with RTL to assert on the rendered branch. We mock
 * `@/lib/auth` to control the viewer session and global `fetch` to drive
 * the upstream preview call.
 *
 * `<AcceptInvitationButton>` is mocked to a simple stub — its own behaviour
 * is covered by `accept-invitation-button.spec.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const auth = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...a: unknown[]) => auth(...a),
}));

// Stub the client child so we can assert it was rendered without
// pulling next/navigation + next-auth/react into this test.
vi.mock('../accept-invitation-button.js', () => ({
  AcceptInvitationButton: ({ token, orgName }: { token: string; orgName: string }) => (
    <div data-testid="accept-button-stub" data-token={token} data-org={orgName}>
      Accept stub
    </div>
  ),
}));

import AcceptInvitationPage from '../page.js';

beforeEach(() => {
  auth.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_URL', 'http://api.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function previewOk(overrides: Partial<Record<string, unknown>> = {}): Response {
  return new Response(
    JSON.stringify({
      orgName: 'Globex',
      orgSlug: 'globex',
      inviterName: 'Alice',
      role: 'ANALYST',
      expiresAt: '2030-01-01T00:00:00.000Z',
      status: 'PENDING',
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function previewErr(status: number, code?: string): Response {
  return new Response(JSON.stringify(code ? { code, message: code } : {}), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function renderPage(token: string): Promise<void> {
  const node = await AcceptInvitationPage({ params: Promise.resolve({ token }) });
  render(node);
}

describe('/accept/[token] page', () => {
  it('renders error branch when preview returns 410 INVITATION_REVOKED', async () => {
    auth.mockResolvedValue(null);
    fetchMock.mockResolvedValue(previewErr(410, 'INVITATION_REVOKED'));

    await renderPage('tok-1');

    expect(screen.getByTestId('accept-page-error')).toBeInTheDocument();
    expect(screen.getByTestId('accept-page-error-message').textContent).toMatch(/revoked/i);
    // Branch 1 must NOT render either of the other branches.
    expect(screen.queryByTestId('accept-page-signin')).toBeNull();
    expect(screen.queryByTestId('accept-page-accept')).toBeNull();
  });

  it('renders error branch with generic message on 404 with no upstream code', async () => {
    auth.mockResolvedValue(null);
    fetchMock.mockResolvedValue(previewErr(404));

    await renderPage('tok-2');

    expect(screen.getByTestId('accept-page-error')).toBeInTheDocument();
    expect(screen.getByTestId('accept-page-error-message').textContent).toMatch(/404/);
  });

  it('renders sign-in branch when preview ok and viewer is anonymous', async () => {
    auth.mockResolvedValue(null);
    fetchMock.mockResolvedValue(previewOk());

    await renderPage('tok-3');

    expect(screen.getByTestId('accept-page-signin')).toBeInTheDocument();
    const cta = screen.getByTestId('accept-page-signin-cta') as HTMLAnchorElement;
    // R-Public-Routes: callbackUrl bounces back here after auth.
    expect(cta.getAttribute('href')).toBe('/login?callbackUrl=%2Faccept%2Ftok-3');
    expect(screen.queryByTestId('accept-page-accept')).toBeNull();
    expect(screen.queryByTestId('accept-button-stub')).toBeNull();
  });

  it('renders accept branch when preview ok and viewer is authenticated', async () => {
    auth.mockResolvedValue({ user: { id: 'user-1', email: 'invitee@example.com' } });
    fetchMock.mockResolvedValue(previewOk());

    await renderPage('tok-4');

    expect(screen.getByTestId('accept-page-accept')).toBeInTheDocument();
    const stub = screen.getByTestId('accept-button-stub');
    expect(stub.getAttribute('data-token')).toBe('tok-4');
    expect(stub.getAttribute('data-org')).toBe('Globex');
    expect(screen.queryByTestId('accept-page-signin')).toBeNull();
  });

  it('passes cache: no-store and the right URL when fetching the preview', async () => {
    auth.mockResolvedValue(null);
    fetchMock.mockResolvedValue(previewOk());

    await renderPage('tok-with/slash');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // encodeURIComponent on the token — slashes must be escaped.
    expect(url).toBe('http://api.test/invitations/tok-with%2Fslash');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
  });
});
