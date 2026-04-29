/**
 * DI tokens for `SettingsModule`.
 *
 * Foot-gun #667 (tsx + NestJS DI): the `tsx`/esbuild transformer does
 * NOT emit `design:paramtypes` metadata, so interface-typed constructor
 * params cannot be resolved by class. Every consumer pairs
 * `@Inject(TOKEN)` with one of these symbols.
 *
 * - {@link SETTINGS_REPO_TOKEN}: persistence boundary for the settings
 *   module (`SettingsRepo`). B2 wires `PrismaSettingsRepo` against this
 *   token; tests rebind via `useValue` for vi-mocked repos.
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Get-Or-Create,
 *   R-Settings-Update.
 * Design: `sdd/jurisdictions-config/design` §0 D5 (DI), §5.
 */
export const SETTINGS_REPO_TOKEN = Symbol('SETTINGS_REPO_TOKEN');
