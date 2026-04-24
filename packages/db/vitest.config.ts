import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', '__tests__/**/*.{test,spec}.ts'],
    // Exclude generated Prisma client from test discovery.
    exclude: ['**/node_modules/**', '**/generated/**'],
  },
});
