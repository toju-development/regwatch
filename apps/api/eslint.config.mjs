import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
