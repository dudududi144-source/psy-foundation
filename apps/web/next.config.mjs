/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Phase 0 Day 4: ignoreBuildErrors REMOVED — tsc --noEmit passes with 0 errors.
  // (noUncheckedIndexedAccess: false in apps/web/tsconfig.json because the
  // psy4 engine uses array indexing patterns that would need explicit undefined
  // guards — Phase 1 will fix root cause and re-enable strict checking.)
  reactStrictMode: false,
  // @psy-foundation/* packages resolve via Bun workspace symlinks in
  // apps/web/node_modules/@psy-foundation/* (see package.json deps).
  // No turbopack/webpack alias needed — workspace:* resolution handles it.
};

export default nextConfig;
