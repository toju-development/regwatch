/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
