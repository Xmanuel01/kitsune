import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // Correct Turbopack config for Next 16
  turbopack: {}, 
};

export default withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
})(nextConfig);

// Webpack aliases for server-side only to stub test/dev-only modules that
// some dependencies (e.g. `thread-stream`) include in their package tree.
// These imports are not required at runtime in production for our app and
// cause Turbopack to fail when it encounters test files and unknown types.
// The alias is applied only on server builds via the `webpack` function.
export const webpack = (config, { isServer }) => {
  if (isServer && config && config.resolve && config.resolve.alias) {
    const path = require('path');
    const aliasTarget = path.resolve('./src/server-shims/empty.js');
    Object.assign(config.resolve.alias, {
      'thread-stream': aliasTarget,
      'tap': aliasTarget,
      'desm': aliasTarget,
      'fastbench': aliasTarget,
      'pino-elasticsearch': aliasTarget,
      'why-is-node-running': aliasTarget,
      'sonic-boom': aliasTarget,
      'pino-tee': aliasTarget,
    });
  }
  return config;
};
