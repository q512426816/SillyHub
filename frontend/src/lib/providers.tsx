/**
 * AppProviders — react-query 全局 Provider 装配（D-004@v1）。
 *
 * 在根 layout 的 <AntdProviders> 内层挂载。QueryClient 用 useState 工厂法创建
 * 稳定实例（R-01：避免 SSR 跨请求共享缓存，避免每次渲染重建）。DevTools 仅 dev
 * 挂载（组件自身按 NODE_ENV tree-shake，生产构建不含，R-04）。
 */
"use client";
import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { makeQueryClient } from "./query-client";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => makeQueryClient());
  return (
    <QueryClientProvider client={client}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
