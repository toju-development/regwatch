// MVP-5: copy-pasted from apps/api/src/common/auth/. Extract to
// packages/auth-guards in MVP-13. See B5 apply-progress.
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '@regwatch/types';

/**
 * Param decorator that returns the authenticated principal attached by
 * {@link JwtAuthGuard}. Returns `undefined` for `@Public()` routes.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return request.user;
  },
);
