/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is required by deploy/docker-compose.yml but breaks local
  // `next build` on Windows without admin privileges (symlink EPERM). Toggle
  // via env var so CI / Docker builds opt in.
  output: process.env.NEXT_BUILD_STANDALONE === "1" ? "standalone" : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
