import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
