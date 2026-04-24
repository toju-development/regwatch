import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@regwatch/db',
              message: 'apps/landing must not depend on @regwatch/db (RSC isolation invariant).',
            },
            {
              name: '@/components/ui/button',
              message: 'apps/landing must not depend on shadcn (lives in apps/web only).',
            },
          ],
          patterns: ['@regwatch/db/*'],
        },
      ],
    },
  },
];
