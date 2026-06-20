"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * ql-20260620：workspaces/[id] 路由级错误边界。
 *
 * 覆盖该目录下所有页面（agent 控制台、workspace 首页、change、task）——即所有
 * 使用 AgentLogViewer 的页面。此前应用没有任何 ErrorBoundary，单条日志数据触发
 * 的渲染异常会让整页白屏（生产模式显示 "Application error: a client-side
 * exception has occurred"）。本边界兜底：捕获页面级渲染错误，展示重试入口，
 * 并把错误打到 console 便于定位（生产模式默认看不到堆栈）。
 *
 * 注：App Router 中 error.tsx 不捕获同级 layout.tsx 的错误，但 [id]/layout.tsx
 * 极简不会崩；细粒度的单条日志隔离由 AgentLogViewer 内部的 ErrorBoundary 负责。
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[workspace-page-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="text-base font-medium text-zinc-900">页面渲染出错</div>
      <div className="max-w-md break-all text-xs text-zinc-500">
        {error?.message || "发生未知客户端错误，请打开浏览器控制台查看详细信息。"}
      </div>
      <Button size="sm" onClick={() => reset()}>
        重试
      </Button>
    </div>
  );
}
