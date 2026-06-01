/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_BUILD_STANDALONE === "1" ? "standalone" : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    const apiBaseUrl = (
      process.env.INTERNAL_API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://localhost:8000"
    ).replace(/\/$/, "");

    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
