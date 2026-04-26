import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '@regwatch/types';

/**
 * Param decorator returning `request.membership.organizationId` —
 * the active organization id resolved by `OrgScopeGuard` from the
 * `X-Org-Id` request header against the JWT `memberships[]` claim.
 *
 * Throws if accessed on a route NOT protected by `OrgScopeGuard`
 * (i.e. `@Public()` or `@PublicScope()` routes) — that's a caller
 * bug: those routes have no resolved active org by definition.
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "OrgScopeGuard Resolves
 * Active Organization" S "X-Org-Id matches a membership".
 * Design: `sdd/auth-authorization-guards/design` §1 (request augmentation).
 */
export const CurrentOrg = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const membership = request.membership;
  if (!membership) {
    throw new InternalServerErrorException(
      '@CurrentOrg() used on a route without OrgScopeGuard (no request.membership).',
    );
  }
  return membership.organizationId;
});

/**
 * Param decorator returning `request.membership.role` — the active
 * `Role` of the authenticated principal within the resolved org.
 *
 * Throws if accessed on a `@Public()` / `@PublicScope()` route — see
 * {@link CurrentOrg}.
 *
 * Design: `sdd/auth-authorization-guards/design` §1.
 */
export const CurrentRole = createParamDecorator((_data: unknown, ctx: ExecutionContext): Role => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const membership = request.membership;
  if (!membership) {
    throw new InternalServerErrorException(
      '@CurrentRole() used on a route without OrgScopeGuard (no request.membership).',
    );
  }
  return membership.role;
});
