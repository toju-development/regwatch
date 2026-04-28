import { z } from 'zod';

/**
 * Response schema for `GET /org/me` (`@PublicScope()` — JWT required).
 *
 * Spec: `sdd/org-membership-ux/spec` R-Org-GetMe — derived from JWT
 * `memberships[]` JOINed against `Organization` for `orgName`. `isPersonal`
 * is `true` iff `orgId === User.personalOrgId`. `activeOrgId` mirrors the
 * resolved active org from the request `X-Org-Id` header (when present and
 * valid for this user) or `null` otherwise — server-side auto-pick + cookie
 * write is performed by the WEB layer (`apps/web/src/lib/active-org-resolve.ts`),
 * NOT by this API. See design §2 NOTE on R-ActiveOrgCookie coupling.
 *
 * `exactOptionalPropertyTypes`: `activeOrgId` is `string | null` (never
 * omitted) per design §11.
 */
export const meResponseSchema = z.object({
  memberships: z.array(
    z.object({
      orgId: z.string(),
      orgSlug: z.string(),
      orgName: z.string(),
      role: z.enum(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']),
      isPersonal: z.boolean(),
    }),
  ),
  activeOrgId: z.string().nullable(),
});

export type MeResponseDto = z.infer<typeof meResponseSchema>;
export type MeMembershipDto = MeResponseDto['memberships'][number];
