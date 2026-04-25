import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
  },
  resolve: {
    alias: {
      // `server-only` throws on import — stub it out for unit tests that
      // pull in server modules (e.g. via `@regwatch/db`).
      'server-only': path.resolve(__dirname, 'test/server-only-stub.ts'),
    },
  },
});
