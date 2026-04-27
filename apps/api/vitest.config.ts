import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@regwatch/api`.
 *
 * Uses `unplugin-swc` (SWC + `.swcrc`) to transpile TS so that NestJS
 * decorator metadata (`emitDecoratorMetadata`) is emitted at test time.
 * Vitest's default esbuild transformer does NOT emit `design:type` /
 * `design:paramtypes` metadata — without it Nest cannot resolve param
 * decorators (`@Body()`, `@Headers()`, etc.) at runtime, manifesting as
 * mysterious 400/500 responses in `Test.createTestingModule()` HTTP runs.
 *
 * Discovery: `regwatch/footguns/vitest-nestjs-decorator-metadata`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
