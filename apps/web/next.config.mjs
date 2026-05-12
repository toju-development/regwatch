/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for Docker / Cloud Run deployment.
  // The .next/standalone output includes all necessary server-side JS and a
  // bundled node_modules, without requiring a full pnpm workspace at runtime.
  // See: https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', '@regwatch/db'],
  // Workspace TS packages publish source with NodeNext-style `.js` import
  // suffixes (e.g. `from './core.js'`). Next/webpack cannot resolve those
  // without transpilation through SWC. See spec auth-foundation § config.
  transpilePackages: ['@regwatch/config', '@regwatch/types'],
  webpack: (config) => {
    // NodeNext source emits `.js` suffixes that point at `.ts` files at
    // resolution time. Webpack needs an extensionAlias to follow them.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
