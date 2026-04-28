import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

/**
 * Boot-time validator for the invitations module's environment surface.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal note "TTL and
 * acceptUrl base are configuration, not code".
 * Design: `sdd/org-invitations/design` §1 (env contract) — sibling of
 * `AuthStartupValidator` which validates decorator combos rather than env.
 *
 * Two checks, both fail-fast (`OnModuleInit` throws → Nest aborts boot):
 *
 *   1. `INVITATION_TTL_DAYS` — when SET, MUST parse to a positive
 *      integer. Unset is OK (the module falls back to 7 inside
 *      `parsePositiveIntEnv`). Failing here prevents the silent
 *      `new Date(NaN)` cascade at issue-time when ops sets a malformed
 *      value (e.g. `"7d"` instead of `"7"`).
 *
 *   2. `WEB_URL` — REQUIRED in `NODE_ENV=production`. The module's
 *      `useValue` falls back to `http://localhost:3000` for dev/test
 *      ergonomics, but a production deploy with a missing `WEB_URL`
 *      means EVERY accept link in EVERY invitation email points at
 *      localhost — silent, irreversible, and only visible after the
 *      first invitee clicks. Fail at boot instead.
 *
 * Why a separate validator (not `AuthStartupValidator`): keeping
 * concerns split per module is the cleaner contract — the auth
 * validator's job is the `@Public + @Roles` decorator-combo invariant
 * (a guard-graph property), not env shape. Cross-pollinating would
 * couple `AuthModule` to every domain module that has env constraints.
 *
 * Foot-gun #667: zero `@Inject(...)` constructor params here — this
 * provider takes none, so the tsx metadata-emission limitation does
 * not apply.
 */
@Injectable()
export class InvitationsStartupValidator implements OnModuleInit {
  private readonly logger = new Logger(InvitationsStartupValidator.name);

  /**
   * The validator reads `process.env` directly rather than injecting
   * the resolved `INVITATION_TTL_DAYS` / `WEB_URL` tokens because by
   * the time those tokens have been provided the malformed value has
   * already been silently coerced (TTL → 7) or defaulted (WEB_URL →
   * localhost). The whole point of THIS validator is to reject that
   * coercion in production.
   */
  onModuleInit(): void {
    this.validateTtl();
    this.validateWebUrl();
  }

  private validateTtl(): void {
    const raw = process.env['INVITATION_TTL_DAYS'];
    if (raw === undefined || raw === '') return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
      throw new Error(
        `INVITATION_TTL_DAYS must be a positive integer (got "${raw}"). ` +
          'A malformed value would silently coerce to NaN at issue-time.',
      );
    }
  }

  private validateWebUrl(): void {
    const nodeEnv = process.env['NODE_ENV'];
    const webUrl = process.env['WEB_URL'];
    if (nodeEnv === 'production' && (webUrl === undefined || webUrl === '')) {
      throw new Error(
        'WEB_URL is required in NODE_ENV=production. ' +
          'Without it every invitation acceptUrl would point at http://localhost:3000.',
      );
    }
    if (webUrl !== undefined && webUrl !== '') {
      try {
        // URL constructor throws on malformed input — catch and
        // re-emit with module-specific context.
        new URL(webUrl);
      } catch {
        throw new Error(
          `WEB_URL must be a valid URL (got "${webUrl}"). ` +
            'Used as the base of every invitation acceptUrl.',
        );
      }
    } else if (nodeEnv !== 'production') {
      this.logger.warn(
        `WEB_URL is unset; falling back to http://localhost:3000 (NODE_ENV=${nodeEnv ?? 'undefined'}).`,
      );
    }
  }
}
