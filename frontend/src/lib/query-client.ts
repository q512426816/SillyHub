/**
 * QueryClient 工厂 — freshness-first 默认配置（D-002@v1）。
 *
 * 每个浏览器会话通过 makeQueryClient() 在 providers.tsx 的 useState 初始化器里
 * 创建独立实例。**禁止**导出模块级单例：Next.js App Router 下模块级单例会在
 * SSR 期间跨请求泄漏缓存（R-01）。
 *
 * 默认策略（对齐原手写 setInterval 轮询的控制台语义）：
 * - staleTime 0 + refetchOnWindowFocus → 窗口聚焦即刷新，监控/控制台最贴近原行为。
 * - retry：仅 5xx（服务端故障）最多 3 次；4xx（含 401/403/404）不重试——鉴权/
 *   not-found 重试无意义，401 由既有 token-refresh 层处理。
 * - 全局不设 refetchInterval：各 hook 自带 cadence（Agent 5s 条件 / Runtime 15s）。
 */
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnWindowFocus: true,
        retry: (count, err) =>
          err instanceof ApiError && err.status >= 500 ? count < 3 : false,
      },
    },
  });
}
