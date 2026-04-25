import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '@regwatch/types';

/**
 * Param decorator that returns the authenticated principal attached by
 * {@link JwtAuthGuard}. Returns `undefined` for `@Public()` routes (no
 * guard ran) — caller code must account for that.
 *
 * Spec: `sdd/auth-foundation/spec` R "Protected API Route via JwtAuthGuard"
 * S "Valid token authorizes" — controller reads claims via `@CurrentUser()`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return request.user;
  },
);
