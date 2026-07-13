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
      // /daemon/* 公开端点（install.sh / latest.json / sillyhub-daemon.js / mcp-server.js，
      // 由 backend dist_router 提供，无 /api 前缀）。前端 server-url 用 window.location.origin，
      // 故 curl|bash 拉的 install.sh 及脚本内 fetch 的 latest.json + bundle 都经前端代理到 backend
      // （ql-20260713-002：之前只代理 /api，/daemon/* 命中前端 404）。
      {
        source: "/daemon/:path*",
        destination: `${apiBaseUrl}/daemon/:path*`,
      },
    ];
  },
};

export default nextConfig;
