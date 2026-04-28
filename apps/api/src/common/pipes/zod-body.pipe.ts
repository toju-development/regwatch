import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Minimal Zod 4 → Nest validation pipe.
 *
 * Originally lived inline in `organizations.controller.ts` (YAGNI — "kept
 * inline until a second module needs it"). `members.controller.ts`
 * (sdd/org-members B4) is that second module, so the pipe is now factored
 * to `common/pipes/` for reuse. Behavior unchanged: throws
 * `BadRequestException` on parse failure carrying the flattened
 * `ZodError.issues` for client-friendly diagnostics.
 *
 * Spec: `sdd/org-membership-ux/spec` R-OrgCreate "Empty/oversize name → 400"
 *   AND `sdd/org-members/spec` R-Membership-Update body validation.
 */
export class ZodBodyPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
