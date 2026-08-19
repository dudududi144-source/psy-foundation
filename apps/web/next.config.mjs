/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Phase 0: temporarily kept until Phase 1 fixes all type errors.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // @psy-foundation/* packages resolve via Bun workspace symlinks in
  // apps/web/node_modules/@psy-foundation/* (see package.json deps).
  // No turbopack/webpack alias needed — workspace:* resolution handles it.
};

export default nextConfig;
