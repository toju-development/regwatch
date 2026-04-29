/**
 * `/accept/[token]` — public RSC landing page for invitation acceptance.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Preview (anonymous fetch — display-safe fields only).
 *   - R-Invitation-Accept (authed accept; surfaces 3xx/4xx codes).
 *   - R-Public-Routes (page MUST be reachable without a session).
 *
 * Design: `sdd/org-invitations/design` §0 D10 (RSC fetches the public
 *   preview directly from `apps/api`, NOT through the proxy — anonymous
 *   server fetch with `cache: 'no-store'`; B6 middleware short-circuits
 *   `/accept/*` so this page renders without auth).
 *
 * Three branches:
 *   1. Preview fetch fails (404 INVITATION_NOT_FOUND, 410 REVOKED/EXPIRED/
 *      ACCEPTED) → render an error card with the upstream code.
 *   2. Preview ok + viewer NOT signed in → render sign-in CTA with
 *      `callbackUrl=/accept/<token>` so NextAuth bounces back here
 *      after successful auth.
 *   3. Preview ok + viewer signed in → render `<AcceptInvitationButton>`.
 *
 * Why anonymous direct upstream fetch:
 *   - The page is a public RSC — no Bearer JWT to forward.
 *   - The preview endpoint is `@Public()` upstream — no auth needed.
 *   - Avoids inheriting the caller's JWT (which would also be wrong on
 *     the unauth path).
 */
import Link from 'next/link';
import type { Role } from '@regwatch/types';

import { auth } from '@/lib/auth';

import { AcceptInvitationButton } from './accept-invitation-button';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Wire shape of `GET /invitations/:token` (public preview). Mirrors
 * `apps/api/src/modules/invitations/invitations.controller.ts` — the
 * @Public() route returns ONLY display-safe fields.
 */
interface PreviewWire {
  orgName: string;
  orgSlug: string;
  inviterName: string | null;
  role: Role;
  expiresAt: string;
  status: 'PENDING';
}

interface PreviewErrorWire {
  code?: string;
  message?: string;
}

interface PreviewResult {
  ok: boolean;
  preview?: PreviewWire;
  errorCode?: string | undefined;
  status?: number | undefined;
}

function getApiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      '/accept/[token]: process.env.API_URL is not set. Configure it via apps/web/.env.example.',
    );
  }
  return url.replace(/\/+$/, '');
}

async function fetchPreview(token: string): Promise<PreviewResult> {
  const res = await fetch(`${getApiBaseUrl()}/invitations/${encodeURIComponent(token)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (res.ok) {
    const preview = (await res.json()) as PreviewWire;
    return { ok: true, preview };
  }
  let body: PreviewErrorWire = {};
  try {
    body = (await res.json()) as PreviewErrorWire;
  } catch {
    /* non-JSON */
  }
  return { ok: false, errorCode: body.code, status: res.status };
}

function describePreviewError(errorCode: string | undefined, status: number | undefined): string {
  switch (errorCode) {
    case 'INVITATION_NOT_FOUND':
      return 'This invitation could not be found. The link may have been mistyped.';
    case 'INVITATION_REVOKED':
      return 'This invitation has been revoked by an administrator.';
    case 'INVITATION_EXPIRED':
      return 'This invitation has expired. Ask the inviter for a new link.';
    case 'INVITATION_ACCEPTED':
      return 'This invitation has already been accepted.';
    default:
      return `Unable to load this invitation${status ? ` (${status})` : ''}.`;
  }
}

interface AcceptPageParams {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitationPage({
  params,
}: AcceptPageParams): Promise<React.ReactElement> {
  const { token } = await params;
  const [session, previewResult] = await Promise.all([auth(), fetchPreview(token)]);

  // Branch 1: preview fetch failed (404 / 410).
  if (!previewResult.ok || !previewResult.preview) {
    return (
      <main
        className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-8"
        data-testid="accept-page-error"
      >
        <div className="w-full rounded-md border p-6">
          <h1 className="text-xl font-semibold">Invitation unavailable</h1>
          <p className="text-muted-foreground mt-2 text-sm" data-testid="accept-page-error-message">
            {describePreviewError(previewResult.errorCode, previewResult.status)}
          </p>
          <Link
            href="/dashboard"
            className="text-primary mt-4 inline-block text-sm underline"
            data-testid="accept-page-error-home"
          >
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const preview = previewResult.preview;
  const callbackUrl = `/accept/${encodeURIComponent(token)}`;

  // Branch 2: preview ok + viewer NOT signed in.
  if (!session?.user) {
    return (
      <main
        className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-8"
        data-testid="accept-page-signin"
      >
        <div className="w-full rounded-md border p-6">
          <h1 className="text-xl font-semibold">Join {preview.orgName}</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {preview.inviterName ? (
              <>
                <span className="font-medium">{preview.inviterName}</span> invited you to join{' '}
                <span className="font-medium">{preview.orgName}</span> as{' '}
                <span className="font-medium">{preview.role}</span>.
              </>
            ) : (
              <>
                You&apos;ve been invited to join{' '}
                <span className="font-medium">{preview.orgName}</span> as{' '}
                <span className="font-medium">{preview.role}</span>.
              </>
            )}
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            Sign in to accept this invitation. Be sure to use the email address it was sent to.
          </p>
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow"
            data-testid="accept-page-signin-cta"
          >
            Sign in to accept
          </Link>
        </div>
      </main>
    );
  }

  // Branch 3: preview ok + viewer signed in → show accept button.
  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-8"
      data-testid="accept-page-accept"
    >
      <div className="w-full rounded-md border p-6">
        <h1 className="text-xl font-semibold">Join {preview.orgName}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {preview.inviterName ? (
            <>
              <span className="font-medium">{preview.inviterName}</span> invited you to join{' '}
              <span className="font-medium">{preview.orgName}</span> as{' '}
              <span className="font-medium">{preview.role}</span>.
            </>
          ) : (
            <>
              You&apos;ve been invited to join{' '}
              <span className="font-medium">{preview.orgName}</span> as{' '}
              <span className="font-medium">{preview.role}</span>.
            </>
          )}
        </p>
        <div className="mt-4">
          <AcceptInvitationButton token={token} orgName={preview.orgName} />
        </div>
      </div>
    </main>
  );
}
