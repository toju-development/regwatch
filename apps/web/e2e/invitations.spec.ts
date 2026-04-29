import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient, type Role } from '@regwatch/db/client';

/**
 * E2E coverage for `sdd/org-invitations/spec` § R-Invitation-Issue,
 * R-Invitation-Preview, R-Invitation-Accept, R-Invitation-Revoke,
 * R-Email-Port-Hexagonal. Slice MVP-3b3b Batch B8.
 *
 * Four scenarios + cold-route compile sweep:
 *
 *   1. **Issue happy path** — OWNER fills `<InviteMemberForm>` on
 *      `/settings/members`, a PENDING row appears in
 *      `<PendingInvitationsList>` AND the dev-only `/test/email-inbox`
 *      contains an invitation email whose body carries the `acceptUrl`
 *      with the freshly-minted token. Asserts D9 mutations-via-server-
 *      actions wiring AND D3 post-commit fire-and-forget email path.
 *
 *   2. **Accept happy path** (the heaviest) — OWNER A invites user B;
 *      B signs in (separate context) with the invited email, lands on
 *      `/accept/<token>`, clicks accept. Assertions:
 *        - B redirects to `/settings/members` of the NEW org (active-org
 *          cookie switched + JWT re-minted by `session.update({})`).
 *        - DB has `Membership(B, orgX, VIEWER)` (chokepoint INSERT path).
 *        - `Invitation.acceptedAt` is set.
 *        - Cross-tab: a SECOND ctx for user B (signed in BEFORE accept)
 *          observes the new org via the silent-retry path
 *          (401 STALE_MEMBERSHIPS → `session.update({})` → 200) on
 *          `/api/org/me` after a `page.reload()`. Mirrors members.spec
 *          test #3. Requires `MEMBERSHIPS_FRESHNESS_TTL_MS=0` on the
 *          API process — set in `playwright.config.ts` § api env.
 *
 *   3. **Email mismatch** — OWNER invites `wronguser@…`; a different
 *      authed user navigates to `/accept/<token>`, sees the preview
 *      (200, hydrated `accept-page-accept`), clicks Accept and the
 *      action surfaces the upstream 403 `EMAIL_MISMATCH` inline. DB
 *      assertions: NO Membership for the wrong user; invitation row
 *      still PENDING (`acceptedAt = null`, `revokedAt = null`).
 *
 *   4. **Revoke flow** — OWNER opens kebab → revoke → confirm dialog →
 *      pending row disappears. DB assertion: `revokedAt != null`.
 *      Subsequent `GET /api/invitations/<token>` (anonymous, the path
 *      that backs the public RSC) returns 410 `INVITATION_REVOKED`,
 *      matching the page's error branch.
 *
 * **Cold compile sweep** is folded into the FIRST test (Test 1) so
 * that the public preview routes (`/accept/<garbage>` page render and
 * `/api/invitations/<garbage>` proxy) AND the authed list endpoint
 * (`/api/org/<id>/invitations`) are exercised on first cold compile
 * AFTER the dev server boots. This catches:
 *   - foot-gun #9 next15 default-secure middleware: an accidental
 *     redirect on `/accept/*` would surface as a 30x or auth bounce.
 *   - foot-gun cold-route-stale-jwt-race: the second `page.reload()`
 *     on a freshly-compiled authed route can otherwise serve a stale
 *     JWT from the cookie jar before `session.update({})` propagates.
 *
 * --- Foot-guns kept in front of future debuggers ---
 *
 *   1. **No `MEMBER` role** — the Prisma `Role` enum is
 *      `OWNER | ADMIN | ANALYST | VIEWER`. The default UI role is
 *      `VIEWER` (see `apps/web/src/components/members/invite-member-form.tsx`
 *      L45). The B8 task brief that mentions a `MEMBER` role predates
 *      the schema lock — VIEWER is the canonical "regular member"
 *      slot and is what these tests exercise (mirrors members.spec
 *      foot-gun #1).
 *
 *   2. **Two API inboxes** — `apps/api`'s `/test/email-inbox` (PORT
 *      3001, snapshot of `EmailMessage[]`) is what serves invitation
 *      emails. Do NOT confuse with `apps/web`'s
 *      `/api/test/inbox/<email>` (Magic Link transport for
 *      `auth.spec.ts`, port 3000). They are SEPARATE inboxes wired to
 *      DIFFERENT processes.
 *
 *   3. **Active-org cookie after accept** — the action sets the cookie
 *      via `cookies().set('regwatch.active-org', orgId, …)` and the
 *      client-side `<AcceptInvitationButton>` calls
 *      `await session.update?.({})` BEFORE `router.replace`. So the
 *      JWT IS re-minted before nav. The `page.reload()` after the
 *      success URL is defense-in-depth against
 *      `router-replace-after-session-update-may-render-stale-jwt-on-cold-route`.
 *
 *   4. **Public RSC fetches API directly** — `/accept/[token]` page.tsx
 *      calls `fetch(API_URL + '/invitations/' + token)` (anonymous,
 *      `cache: 'no-store'`). NO proxy, NO auth. Cold render must
 *      succeed without any cookie present.
 */

// ─── Prisma client (test-process-scoped) ──────────────────────────────────
const DEFAULT_DB_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? DEFAULT_DB_URL } },
});

// ─── API base — distinct from Playwright `baseURL` (web @ 3000) ───────────
const API_BASE = 'http://localhost:3001';

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function uniqueEmail(tag: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

async function fakeGoogleSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('fake-google-email').fill(email);
  const [actionResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/login') && r.request().method() === 'POST'),
    page.getByTestId('fake-google-signin').click(),
  ]);
  expect([200, 303]).toContain(actionResp.status());
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
  await page.waitForLoadState('load');
}

interface CreateOrgResponse {
  id: string;
  name: string;
  slug: string;
}

async function postOrgViaProxy(context: BrowserContext, name: string): Promise<CreateOrgResponse> {
  const res = await context.request.post('/api/org', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ name }),
  });
  expect(res.status(), `POST /api/org body=${await res.text()}`).toBe(201);
  return (await res.json()) as CreateOrgResponse;
}

async function switchActiveOrg(context: BrowserContext, orgId: string): Promise<void> {
  const res = await context.request.post('/api/org/switch', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ orgId }),
  });
  expect(res.status(), `POST /api/org/switch body=${await res.text()}`).toBe(204);
}

/**
 * Re-mint the OWNER's JWT after a chokepoint write (POST /api/org bumps
 * `mv`). Same pattern as `members.spec.ts`. `expected` is the membership
 * count AFTER the new org (typically 2 = personal + new).
 */
async function refreshSessionAndExpectMembershipCount(page: Page, expected: number): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-hydrated')).toHaveText('yes');
  await page.getByTestId('dashboard-refresh-session').click();
  await expect(page.getByTestId('dashboard-membership-count')).toHaveText(String(expected), {
    timeout: 10_000,
  });
}

interface SentInboxMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Fetch the in-memory inbox snapshot from `apps/api`'s test-only
 * controller (`/test/email-inbox`, port 3001, double-guarded by
 * `NODE_ENV !== production` AND `EMAIL_TRANSPORT === memory`).
 *
 * Returns the array oldest-to-newest.
 */
async function getApiInbox(context: BrowserContext): Promise<SentInboxMessage[]> {
  const res = await context.request.get(`${API_BASE}/test/email-inbox`);
  expect(res.status(), `GET /test/email-inbox body=${await res.text()}`).toBe(200);
  return (await res.json()) as SentInboxMessage[];
}

/**
 * Wait until the API inbox surfaces a message addressed to `email`
 * and return the most recent one. Polls because email dispatch is
 * post-commit fire-and-forget (D3) — there is a small window between
 * the 201 response and the listener actually pushing into the inbox.
 */
async function waitForLastInvitationEmail(
  context: BrowserContext,
  email: string,
  timeoutMs = 10_000,
): Promise<SentInboxMessage> {
  const target = email.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  let lastInbox: SentInboxMessage[] = [];
  while (Date.now() < deadline) {
    lastInbox = await getApiInbox(context);
    const matches = lastInbox.filter((m) => m.to.toLowerCase() === target);
    if (matches.length > 0) return matches[matches.length - 1]!;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `No invitation email surfaced for ${email} within ${timeoutMs}ms. ` +
      `Inbox snapshot: ${JSON.stringify(lastInbox.map((m) => m.to))}`,
  );
}

/**
 * Extract the invitation token from a sent email body. The listener
 * embeds `${WEB_URL}/accept/${token}` in BOTH the text and the
 * `<a href>` html anchor (`apps/api/src/modules/email/email.listener.ts`
 * `buildMessage`). We grep the text payload — robust against future
 * html template tweaks.
 */
function extractTokenFromInvitationEmail(message: SentInboxMessage): string {
  const re = /\/accept\/([^\s<"']+)/;
  const match = message.text.match(re) ?? message.html.match(re);
  if (!match) {
    throw new Error(
      `Could not find /accept/<token> URL in invitation email. ` +
        `text=${JSON.stringify(message.text.slice(0, 200))} html=${JSON.stringify(message.html.slice(0, 200))}`,
    );
  }
  return decodeURIComponent(match[1]!);
}

/**
 * Issue an invitation by driving the `<InviteMemberForm>`. Returns the
 * captured `acceptUrl` token after polling the API inbox.
 */
async function issueInvitationViaForm(
  page: Page,
  context: BrowserContext,
  inviteeEmail: string,
): Promise<{ token: string; email: SentInboxMessage }> {
  await page.getByTestId('invite-member-form-email').fill(inviteeEmail);
  // Default role is VIEWER (`<InviteMemberForm>` DEFAULT_ROLE). Submit.
  await page.getByTestId('invite-member-form-submit').click();
  await expect(page.getByTestId('invite-member-form-success')).toBeVisible({ timeout: 10_000 });

  const message = await waitForLastInvitationEmail(context, inviteeEmail);
  const token = extractTokenFromInvitationEmail(message);
  return { token, email: message };
}

// ─── Tests ────────────────────────────────────────────────────────────────

test.describe('Invitations', () => {
  test(
    'R-Invitation-Issue — OWNER issues invitation, pending row appears, email lands in inbox + cold compile sweep',
    { tag: ['@e2e', '@invitations'] },
    async ({ page, context }) => {
      // ─── Cold compile sweep (first test in the file) ──────────────────
      // Hit cold public preview routes BEFORE auth: middleware allowlist
      // (#9 next15 middleware foot-gun) must pass them through.
      const coldGarbage = `cold-${Date.now().toString(36)}`;

      // Cold public RSC `/accept/<garbage>` — page must compile and
      // render the error branch (404 INVITATION_NOT_FOUND), NOT bounce
      // to /login.
      await page.goto(`/accept/${coldGarbage}`);
      await expect(page.getByTestId('accept-page-error')).toBeVisible({ timeout: 30_000 });

      // Cold public preview proxy `/api/invitations/<garbage>` — 404
      // upstream, surfaces as the same 404 through the proxy.
      const coldPreview = await context.request.get(`/api/invitations/${coldGarbage}`);
      expect(coldPreview.status(), 'cold /api/invitations/* must hit upstream').toBe(404);

      // ─── Issue happy path ──────────────────────────────────────────────
      const ownerEmail = uniqueEmail('inv-owner');
      await fakeGoogleSignIn(page, ownerEmail);

      const org = await postOrgViaProxy(context, `Invite Org ${Date.now()}`);
      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, org.id);

      // Cold sweep: authed list endpoint hit before the page that
      // consumes it. Guards against cold-route-stale-jwt-race on
      // first-compile of the authed proxy.
      const coldList = await context.request.get(`/api/org/${org.id}/invitations`, {
        headers: { 'X-Org-Id': org.id },
      });
      expect(
        coldList.status(),
        `cold GET /api/org/:id/invitations body=${await coldList.text()}`,
      ).toBe(200);

      await page.goto('/settings/members');
      await expect(page.getByTestId('members-page')).toBeVisible();
      await expect(page.getByTestId('invite-member-form')).toBeVisible();

      const inviteeEmail = uniqueEmail('invitee');
      await page.getByTestId('invite-member-form-email').fill(inviteeEmail);
      await page.getByTestId('invite-member-form-submit').click();
      await expect(page.getByTestId('invite-member-form-success')).toBeVisible({ timeout: 10_000 });

      // Pending row appears in the merged page.
      await expect(page.getByTestId('pending-invitations-list')).toBeVisible();
      await expect(
        page.locator('[data-testid="pending-invitations-list"]').getByText(inviteeEmail, {
          exact: false,
        }),
      ).toBeVisible({ timeout: 10_000 });

      // Email landed in the API inbox (proves D3 post-commit fire-and-
      // forget AND R-Email-Port-Hexagonal wiring).
      const message = await waitForLastInvitationEmail(context, inviteeEmail);
      const acceptToken = extractTokenFromInvitationEmail(message);
      expect(acceptToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(message.subject).toMatch(/invited you/i);
      expect(message.text).toContain(`/accept/${acceptToken}`);
    },
  );

  test(
    'R-Invitation-Accept — invitee signs in, accepts, lands in new org; second tab observes via STALE retry',
    { tag: ['@e2e', '@invitations', '@critical'] },
    async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB1 = await browser.newContext();
      const ctxB2 = await browser.newContext();
      const pageA = await ctxA.newPage();
      const pageB1 = await ctxB1.newPage();
      const pageB2 = await ctxB2.newPage();

      try {
        // ─── Owner A creates org and issues invitation ───────────────────
        const aEmail = uniqueEmail('accept-owner');
        await fakeGoogleSignIn(pageA, aEmail);
        const orgX = await postOrgViaProxy(ctxA, `Accept Org ${Date.now()}`);
        await refreshSessionAndExpectMembershipCount(pageA, 2);
        await switchActiveOrg(ctxA, orgX.id);

        await pageA.goto('/settings/members');
        await expect(pageA.getByTestId('invite-member-form')).toBeVisible();

        const bEmail = uniqueEmail('accept-invitee');
        const { token } = await issueInvitationViaForm(pageA, ctxA, bEmail);

        // ─── User B (ctxB1) signs in BEFORE accepting so we have a
        //     "second tab" baseline session for the cross-tab assertion.
        //     ctxB1 will be the tab that drives accept; ctxB2 is the
        //     stale-JWT observer.
        await fakeGoogleSignIn(pageB1, bEmail);
        await fakeGoogleSignIn(pageB2, bEmail);

        // Capture B2's `/api/org/me` responses so we can assert the
        // 401-STALE → 200 silent-retry signature after accept.
        const meStatuses: number[] = [];
        pageB2.on('response', (response) => {
          if (response.url().includes('/api/org/me') && response.request().method() === 'GET') {
            meStatuses.push(response.status());
          }
        });

        // Warm B2 — fresh JWT, baseline 200.
        await pageB2.goto('/dashboard');
        await expect(pageB2.getByTestId('dashboard-hydrated')).toHaveText('yes');
        await expect.poll(() => meStatuses.includes(200), { timeout: 15_000 }).toBe(true);
        const baselineLen = meStatuses.length;

        // ─── B (ctxB1) accepts the invitation ─────────────────────────────
        await pageB1.goto(`/accept/${encodeURIComponent(token)}`);
        await expect(pageB1.getByTestId('accept-page-accept')).toBeVisible({ timeout: 15_000 });
        await pageB1.getByTestId('accept-invitation-button').click();

        // Lands on /settings/members of the NEW org (active-org cookie
        // switched + JWT re-minted via `session.update({})` in the
        // <AcceptInvitationButton>).
        await pageB1.waitForURL((url) => url.pathname === '/settings/members', {
          timeout: 15_000,
        });
        // Defense-in-depth against
        // `router-replace-after-session-update-may-render-stale-jwt-on-cold-route`.
        await pageB1.reload();
        await expect(pageB1.getByTestId('members-page')).toBeVisible();
        await expect(pageB1.getByTestId('members-page-org-slug')).toHaveText(orgX.slug);

        // DB invariants: Membership exists for B in orgX with role
        // VIEWER (default UI role from the form), invitation is now
        // ACCEPTED.
        const bUser = await prisma.user.findUnique({ where: { email: bEmail } });
        expect(bUser, 'invitee user must exist post-signin').not.toBeNull();
        const membership = await prisma.membership.findFirst({
          where: { userId: bUser!.id, organizationId: orgX.id },
        });
        expect(membership, 'membership must exist post-accept').not.toBeNull();
        expect(membership!.role as Role).toBe('VIEWER' satisfies Role);

        const invitation = await prisma.invitation.findFirst({
          where: { organizationId: orgX.id, email: bEmail.toLowerCase() },
        });
        expect(invitation, 'invitation row must persist').not.toBeNull();
        expect(invitation!.acceptedAt, 'acceptedAt must be set').not.toBeNull();
        expect(invitation!.revokedAt, 'revokedAt must remain null').toBeNull();

        // ─── Cross-tab silent retry on B2 ────────────────────────────────
        // B2's JWT is now stale (mv on User(B) was bumped by the
        // chokepoint INSERT in InvitationsService.accept →
        // MembersService.createOrGet). Re-mount DashboardClient via
        // reload — the apiFetch should observe 401 STALE_MEMBERSHIPS
        // and silently retry to 200.
        await pageB2.reload();
        await expect(pageB2.getByTestId('dashboard-hydrated')).toHaveText('yes');
        await expect
          .poll(
            () => {
              const after = meStatuses.slice(baselineLen);
              const first401 = after.indexOf(401);
              if (first401 === -1) return false;
              return after.slice(first401 + 1).includes(200);
            },
            {
              timeout: 15_000,
              message: 'expected 401 → 200 on /api/org/me after accept (STALE retry)',
            },
          )
          .toBe(true);

        // Confirm B2 now sees the new org via /api/org/me (the
        // chokepoint INSERT bumped mv, freshness guard cleared on retry).
        const meRes = await ctxB2.request.get('/api/org/me');
        expect(meRes.status(), `GET /api/org/me body=${await meRes.text()}`).toBe(200);
        const meBody = (await meRes.json()) as {
          memberships: Array<{ orgId: string }>;
        };
        const orgIds = meBody.memberships.map((m) => m.orgId);
        expect(orgIds, 'B2 must see the newly-accepted org').toContain(orgX.id);
      } finally {
        await ctxA.close();
        await ctxB1.close();
        await ctxB2.close();
      }
    },
  );

  test(
    'R-Invitation-Accept — accept by a non-invited email surfaces EMAIL_MISMATCH inline; no Membership, invitation stays PENDING',
    { tag: ['@e2e', '@invitations'] },
    async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxC = await browser.newContext();
      const pageA = await ctxA.newPage();
      const pageC = await ctxC.newPage();

      try {
        // OWNER A creates org and invites someone-else.
        const aEmail = uniqueEmail('mismatch-owner');
        await fakeGoogleSignIn(pageA, aEmail);
        const orgX = await postOrgViaProxy(ctxA, `Mismatch Org ${Date.now()}`);
        await refreshSessionAndExpectMembershipCount(pageA, 2);
        await switchActiveOrg(ctxA, orgX.id);

        await pageA.goto('/settings/members');
        await expect(pageA.getByTestId('invite-member-form')).toBeVisible();

        const invitedEmail = uniqueEmail('mismatch-target');
        const { token } = await issueInvitationViaForm(pageA, ctxA, invitedEmail);

        // C signs in with a DIFFERENT email and tries to accept.
        const cEmail = uniqueEmail('mismatch-other');
        await fakeGoogleSignIn(pageC, cEmail);

        await pageC.goto(`/accept/${encodeURIComponent(token)}`);
        await expect(pageC.getByTestId('accept-page-accept')).toBeVisible({ timeout: 15_000 });
        await pageC.getByTestId('accept-invitation-button').click();

        // Inline error surfaces EMAIL_MISMATCH copy. Does NOT navigate
        // to /settings/members.
        const errorEl = pageC.getByTestId('accept-invitation-error');
        await expect(errorEl).toBeVisible({ timeout: 10_000 });
        await expect(errorEl).toHaveText(/different email|EMAIL_MISMATCH/i);
        expect(new URL(pageC.url()).pathname).toBe(`/accept/${token}`);

        // DB: NO Membership for user C in orgX.
        const cUser = await prisma.user.findUnique({ where: { email: cEmail } });
        expect(cUser).not.toBeNull();
        const cMembership = await prisma.membership.findFirst({
          where: { userId: cUser!.id, organizationId: orgX.id },
        });
        expect(cMembership, 'no membership must be created on EMAIL_MISMATCH').toBeNull();

        // Invitation row remains PENDING (acceptedAt null, revokedAt null).
        const inv = await prisma.invitation.findFirst({
          where: { organizationId: orgX.id, email: invitedEmail.toLowerCase() },
        });
        expect(inv, 'invitation row must still exist').not.toBeNull();
        expect(inv!.acceptedAt, 'EMAIL_MISMATCH must NOT set acceptedAt').toBeNull();
        expect(inv!.revokedAt, 'EMAIL_MISMATCH must NOT set revokedAt').toBeNull();
      } finally {
        await ctxA.close();
        await ctxC.close();
      }
    },
  );

  test(
    'R-Invitation-Revoke — OWNER revokes pending row; row disappears, revokedAt set, accept now 410',
    { tag: ['@e2e', '@invitations'] },
    async ({ page, context }) => {
      const ownerEmail = uniqueEmail('revoke-owner');
      await fakeGoogleSignIn(page, ownerEmail);

      const orgX = await postOrgViaProxy(context, `Revoke Org ${Date.now()}`);
      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, orgX.id);

      await page.goto('/settings/members');
      await expect(page.getByTestId('invite-member-form')).toBeVisible();

      const inviteeEmail = uniqueEmail('revoke-target');
      await page.getByTestId('invite-member-form-email').fill(inviteeEmail);
      await page.getByTestId('invite-member-form-submit').click();
      await expect(page.getByTestId('invite-member-form-success')).toBeVisible({ timeout: 10_000 });

      // Capture the issued invitation row via DB so we have its id +
      // token without scraping HTML.
      const issued = await prisma.invitation.findFirst({
        where: { organizationId: orgX.id, email: inviteeEmail.toLowerCase() },
        orderBy: { createdAt: 'desc' },
      });
      expect(issued, 'invitation must persist after issue').not.toBeNull();
      const invitationId = issued!.id;
      const token = issued!.token;

      // Pending row visible.
      await expect(page.getByTestId(`pending-invitation-row-${invitationId}`)).toBeVisible();

      // Open kebab → click Revoke trigger → confirm dialog appears.
      await page.getByTestId(`pending-invitation-menu-${invitationId}`).click();
      await page.getByTestId(`pending-invitation-revoke-trigger-${invitationId}`).click();
      await expect(page.getByTestId(`revoke-invitation-dialog-${invitationId}`)).toBeVisible();

      // Confirm — wait for the server-action POST so revalidate finishes
      // before we re-query the DOM.
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/settings/members') && r.request().method() === 'POST',
          { timeout: 15_000 },
        ),
        page.getByTestId(`revoke-invitation-dialog-confirm-${invitationId}`).click(),
      ]);

      // Row disappears.
      await expect(page.getByTestId(`pending-invitation-row-${invitationId}`)).toBeHidden({
        timeout: 10_000,
      });

      // DB row has revokedAt set.
      const after = await prisma.invitation.findUnique({ where: { id: invitationId } });
      expect(after, 'invitation must still exist').not.toBeNull();
      expect(after!.revokedAt, 'revokedAt must be set after revoke').not.toBeNull();
      expect(after!.acceptedAt, 'acceptedAt must remain null').toBeNull();

      // Anonymous preview now returns 410 INVITATION_REVOKED — matches
      // the `/accept/[token]` page's error branch.
      const previewRes = await context.request.get(`/api/invitations/${encodeURIComponent(token)}`);
      expect(previewRes.status(), 'revoked invitation preview must be 410').toBe(410);
      const body = (await previewRes.json()) as { code?: string };
      expect(body.code).toBe('INVITATION_REVOKED');
    },
  );
});
