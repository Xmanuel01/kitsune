// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['thread-stream'],

  // Remove the webpack config - not needed with Turbopack!
};

module.exports = nextConfig;