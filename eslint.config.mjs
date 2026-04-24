import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import tailwind from 'eslint-plugin-tailwindcss';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/generated/**', '**/.turbo/**', '**/node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['apps/{web,landing}/**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      tailwindcss: tailwind,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['apps/{api,scanner}/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  prettier,
);
