/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_BUILD_STANDALONE === "1" ? "standalone" : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
