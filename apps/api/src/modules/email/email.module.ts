import { Global, Module, type DynamicModule } from '@nestjs/common';
import { EMAIL_PORT } from './email.port.js';
import { MemoryEmailAdapter } from './memory-email.adapter.js';
import { EmailListener } from './email.listener.js';
import { TestInboxController } from './test-inbox.controller.js';
import {
  ResendEmailAdapter,
  RESEND_API_KEY_TOKEN,
  RESEND_FROM_EMAIL_TOKEN,
} from './adapters/resend.adapter.js';

/**
 * `EmailModule` — hexagonal email outbound boundary.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal.
 * Design: `sdd/org-invitations/design` D4 (port shape + memory adapter
 *   provider wiring), D3 (`EmailListener` registration), D13 (test
 *   inbox controller mount predicate).
 * sdd/notify-email-resend (POST-2): task 2.2 — swap to ResendEmailAdapter
 *   when EMAIL_TRANSPORT !== 'memory'.
 *
 * **Wiring (B2):**
 *
 *   - Memory transport (EMAIL_TRANSPORT=memory):
 *     `MemoryEmailAdapter` registered as a class provider so
 *     `TestInboxController` can `@Inject(MemoryEmailAdapter)` and call
 *     non-port methods (`getSent`, `clear`).
 *     `EMAIL_PORT` symbol token bound to the SAME instance via
 *     `useExisting: MemoryEmailAdapter` (avoids minting a second adapter).
 *
 *   - Resend transport (default / production):
 *     `ResendEmailAdapter` registered as a class provider.
 *     `EMAIL_PORT` symbol token bound via `useExisting: ResendEmailAdapter`.
 *     `RESEND_API_KEY_TOKEN` and `RESEND_FROM_EMAIL_TOKEN` string tokens
 *     are provided as value providers from the validated env.
 *
 *   - `EmailListener` is a regular `@Injectable()` provider — its
 *     `@OnEvent` registration happens via `EventEmitterModule` (mounted
 *     in `AppModule`).
 *   - The controller list is computed once at module-evaluation time
 *     based on `NODE_ENV` + `EMAIL_TRANSPORT`.
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
    const isMemory = process.env.EMAIL_TRANSPORT === 'memory';
    const includeTestInbox = process.env.NODE_ENV !== 'production' && isMemory;

    if (isMemory) {
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

    // Resend transport (production / staging)
    return {
      module: EmailModule,
      global: true,
      providers: [
        {
          provide: RESEND_API_KEY_TOKEN,
          useValue: process.env.RESEND_API_KEY,
        },
        {
          provide: RESEND_FROM_EMAIL_TOKEN,
          useValue: process.env.RESEND_FROM_EMAIL,
        },
        ResendEmailAdapter,
        { provide: EMAIL_PORT, useExisting: ResendEmailAdapter },
        EmailListener,
      ],
      controllers: [],
      exports: [EMAIL_PORT],
    };
  }
}
