import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ROLES_KEY } from './decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Bootstrap-time guard that walks every controller handler discovered by
 * `DiscoveryService` and rejects routes that combine `@Public()` with
 * `@Roles(...)`. Per design §1 decorator matrix, this combination is a
 * programmer error: `@Public()` short-circuits all guards (including
 * `RolesGuard`) so the role declaration would silently no-op in prod.
 *
 * Failing fast at startup turns a silent security misconfiguration into
 * an obvious bootstrap error before traffic is served.
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "Guard Registration Order
 * Is Contract" (extension: rejects degenerate `@Public()+@Roles()` combo).
 * Design: `sdd/auth-authorization-guards/design` §1 (startup validation).
 *
 * Constructor uses explicit `@Inject(...)` tokens because the runtime is
 * `tsx` (esbuild) which does NOT emit `design:paramtypes` metadata —
 * carry-forward from MVP-1 tsx+DI decision (engram #628).
 */
@Injectable()
export class AuthStartupValidator implements OnModuleInit {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const offenders: string[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!instance || !metatype) continue;

      const proto = Object.getPrototypeOf(instance) as object | null;
      if (!proto) continue;

      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const isPublic =
          this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
            handler,
            metatype,
          ]) ?? false;

        const requiredRoles = this.reflector.getAllAndOverride<unknown>(ROLES_KEY, [
          handler,
          metatype,
        ]);

        if (isPublic && requiredRoles !== undefined) {
          offenders.push(`${metatype.name}.${methodName}`);
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        `[AuthModule] @Public() and @Roles(...) are mutually exclusive on the same handler. ` +
          `Offender${offenders.length === 1 ? '' : 's'}: ${offenders.join(', ')}`,
      );
    }
  }
}
