import type { NextConfig } from "next";

const FOUNDATION = "/home/z/psy-foundation/packages";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  turbopack: {
    resolveAlias: {
      "@psy-foundation/transport": `${FOUNDATION}/transport/src/index.ts`,
      "@psy-foundation/music": `${FOUNDATION}/music/src/index.ts`,
      "@psy-foundation/learning": `${FOUNDATION}/learning/src/index.ts`,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@psy-foundation/transport": `${FOUNDATION}/transport/src/index.ts`,
      "@psy-foundation/music": `${FOUNDATION}/music/src/index.ts`,
      "@psy-foundation/learning": `${FOUNDATION}/learning/src/index.ts`,
    };
    return config;
  },
};

export default nextConfig;
