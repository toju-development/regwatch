import { randomBytes } from 'node:crypto';
import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { AuthUser, MembershipClaim } from '@regwatch/types';
import type { MeMembershipDto, MeResponseDto } from './dto/me-response.dto.js';
import { ORG_REPO_TOKEN, type OrgRepo } from './org.repo.js';

/**
 * Maximum slug-collision retries for `POST /org`.
 * After this many `P2002` failures the service surfaces a 500.
 */
export const SLUG_RETRY_MAX = 3;

/** Prisma error code for a unique-constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Default slug generator — `node:crypto.randomBytes(6).toString('base64url')`
 * yields ~8-char URL-safe ids, matching `capability/db-schema` R-Slug-deps.
 *
 * Exposed as a constructor argument so unit tests can inject a deterministic
 * sequence (collision-then-success) without monkey-patching `node:crypto`.
 */
export type SlugGenerator = () => string;
export const defaultSlugGenerator: SlugGenerator = () => randomBytes(6).toString('base64url');

interface PrismaP2002Error {
  code: typeof PRISMA_UNIQUE_VIOLATION;
}

function isP2002(err: unknown): err is PrismaP2002Error {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * Business logic for `/org` endpoints.
 *
 * - {@link getMe} — derives the per-user org overview from the JWT
 *   `memberships[]` claim joined to `Organization` for `orgName`, with
 *   `isPersonal` derived from `User.personalOrgId`. `activeOrgId` mirrors
 *   the `X-Org-Id` request header iff valid for this user; the WEB layer
 *   is responsible for auto-pick + cookie writes (design §2 NOTE).
 *
 * - {@link create} — atomically creates one `Organization` AND one
 *   `Membership(role=OWNER)` in a single Prisma `$transaction`. On
 *   slug `P2002` collision the service retries up to {@link SLUG_RETRY_MAX}
 *   times with a freshly generated slug. After that → 500.
 *
 * Spec: `sdd/org-membership-ux/spec` R-Org-GetMe + R-OrgCreate.
 * Design: `sdd/org-membership-ux/design` §2.
 *
 * Foot-gun #645 reaffirmed: do NOT copy the auto-org `updateMany` race
 * idiom here — `POST /org` is NOT subject to the personal-org invariant.
 * Concurrent same-user creates yielding two distinct rows is VALID.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @Inject(ORG_REPO_TOKEN) private readonly repo: OrgRepo,
    private readonly slugGen: SlugGenerator = defaultSlugGenerator,
  ) {}

  /**
   * Build the `GET /me` payload.
   *
   * @param user - JWT-derived principal (memberships claim is the source of truth).
   * @param xOrgId - The `X-Org-Id` request header value, if present. Echoed
   *   back as `activeOrgId` only when it appears in `user.memberships`.
   */
  async getMe(user: AuthUser, xOrgId: string | null): Promise<MeResponseDto> {
    const memberships = user.memberships;
    const orgIds = memberships.map((m) => m.organizationId);

    // Two parallel reads — service handles 1 round-trip per dependency,
    // not N. `personalOrgId` is a single-row select (cheap).
    const [orgs, personalOrgId] = await Promise.all([
      this.repo.findOrganizationsByIds(orgIds),
      this.repo.getUserPersonalOrgId(user.userId),
    ]);

    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const responseMemberships: MeMembershipDto[] = memberships.map(
      (m: MembershipClaim): MeMembershipDto => {
        const org = orgById.get(m.organizationId);
        return {
          orgId: m.organizationId,
          orgSlug: m.orgSlug,
          // If the org row is missing (revoked / deleted between JWT issue
          // and this request) we fall back to slug — never throw, the JWT
          // remains the source of truth for membership existence.
          orgName: org?.name ?? m.orgSlug,
          role: m.role,
          isPersonal: personalOrgId !== null && m.organizationId === personalOrgId,
        };
      },
    );

    const validOrgIdSet = new Set(orgIds);
    const activeOrgId = xOrgId !== null && validOrgIdSet.has(xOrgId) ? xOrgId : null;

    return { memberships: responseMemberships, activeOrgId };
  }

  /**
   * Create a new organization owned by `userId`.
   *
   * Slug retry: on `P2002` the loop generates a fresh slug and retries up
   * to {@link SLUG_RETRY_MAX} times. The (extremely unlikely) exhaustion
   * path surfaces a `500` per spec scenario "5× collision exhaust → 500".
   *
   * Non-`P2002` errors propagate unchanged (Nest maps to 500), preserving
   * the spec scenario "Transaction rollback on membership failure".
   */
  async create(userId: string, name: string): Promise<{ id: string; name: string; slug: string }> {
    let lastError: unknown;

    for (let attempt = 0; attempt < SLUG_RETRY_MAX; attempt += 1) {
      const slug = this.slugGen();
      try {
        const { org } = await this.repo.createOrgWithMembership({ userId, name, slug });
        return { id: org.id, name: org.name, slug: org.slug };
      } catch (err) {
        if (!isP2002(err)) throw err;
        lastError = err;
        this.logger.warn(
          `slug collision (attempt ${attempt + 1}/${SLUG_RETRY_MAX}) for userId=${userId}`,
        );
      }
    }

    this.logger.error(
      `slug collision exhausted ${SLUG_RETRY_MAX} attempts for userId=${userId}`,
      lastError,
    );
    throw new InternalServerErrorException(
      `Failed to allocate a unique slug after ${SLUG_RETRY_MAX} attempts.`,
    );
  }
}
