import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const baseConfig = {
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
  turbopack: {},

  // This is the important part
  webpack: (config, { isServer }) => {
    if (isServer) {
      const path = require("path");
      const aliasTarget = path.resolve("./src/server-shims/empty.js");

      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};

      Object.assign(config.resolve.alias, {
        "thread-stream": aliasTarget,
        tap: aliasTarget,
        desm: aliasTarget,
        "fastbench": aliasTarget,
        "pino-elasticsearch": aliasTarget,
        "why-is-node-running": aliasTarget,
        "sonic-boom": aliasTarget,
        "pino-tee": aliasTarget,
      });
    }
    return config;
  },
};

export default withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
})(baseConfig);
