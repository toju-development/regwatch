import { Global, Module, type DynamicModule } from '@nestjs/common';
import { EMAIL_PORT } from './email.port.js';
import { MemoryEmailAdapter } from './memory-email.adapter.js';
import { EmailListener } from './email.listener.js';
import { TestInboxController } from './test-inbox.controller.js';

/**
 * `EmailModule` — hexagonal email outbound boundary.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal.
 * Design: `sdd/org-invitations/design` D4 (port shape + memory adapter
 *   provider wiring), D3 (`EmailListener` registration), D13 (test
 *   inbox controller mount predicate).
 *
 * **Wiring (B2):**
 *
 *   - `MemoryEmailAdapter` registered as a class provider so
 *     `TestInboxController` can `@Inject(MemoryEmailAdapter)` and call
 *     non-port methods (`getSent`, `clear`).
 *   - `EMAIL_PORT` symbol token bound to the SAME instance via
 *     `useExisting: MemoryEmailAdapter`. This is the canonical
 *     "alias one provider to multiple tokens, share state" pattern in
 *     NestJS — `useClass` would mint a SECOND adapter and break the
 *     inbox visibility for the test controller.
 *   - `EmailListener` is a regular `@Injectable()` provider — its
 *     `@OnEvent` registration happens via `EventEmitterModule` (mounted
 *     in `AppModule`).
 *   - The controller list is computed once at module-evaluation time
 *     based on `NODE_ENV` + `EMAIL_TRANSPORT`. In production, the route
 *     is unreachable; in dev/CI/Playwright the controller is mounted
 *     and additionally re-asserts the predicate per request (see
 *     `TestInboxController.assertEnabled` for D13 defense-in-depth).
 *
 * `@Global()` so the listener can resolve `EMAIL_PORT` regardless of the
 * import topology, and the future `InvitationsModule` (B4/B5) can emit
 * the `invitation.created` event without an explicit `imports[]` entry
 * for `EmailModule`.
 *
 * Foot-gun #667: every consumer uses `@Inject(EMAIL_PORT)` for the port
 * and `@Inject(MemoryEmailAdapter)` for the concrete adapter handle.
 */
@Global()
@Module({})
export class EmailModule {
  static forRoot(): DynamicModule {
    const includeTestInbox =
      process.env.NODE_ENV !== 'production' && process.env.EMAIL_TRANSPORT === 'memory';

    return {
      module: EmailModule,
      global: true,
      providers: [
        MemoryEmailAdapter,
        { provide: EMAIL_PORT, useExisting: MemoryEmailAdapter },
        EmailListener,
      ],
      controllers: includeTestInbox ? [TestInboxController] : [],
      exports: [EMAIL_PORT, MemoryEmailAdapter],
    };
  }
}
