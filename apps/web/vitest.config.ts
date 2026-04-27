import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig has `jsx: 'preserve'` (Next handles transform). For vitest we
  // need esbuild's automatic JSX runtime so component specs don't have to
  // import React explicitly (React 19 idiom).
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
    setupFiles: ['./test/vitest-setup.ts'],
  },
  resolve: {
    alias: {
      // `server-only` throws on import — stub it out for unit tests that
      // pull in server modules (e.g. via `@regwatch/db`).
      'server-only': path.resolve(__dirname, 'test/server-only-stub.ts'),
      // Mirror the Next/TS path alias so component specs can import via
      // `@/...` the same way runtime code does.
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
