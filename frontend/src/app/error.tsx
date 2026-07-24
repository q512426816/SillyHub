"use client";

import { useEffect } from "react";

import { asString } from "@/lib/utils";

/**
 * F1（健壮性，2026-07-24 代码健壮性优化）：路由级错误边界。
 *
 * 此前全应用没有任何 Next.js ``error.tsx`` / ``global-error.tsx``，任意页面在渲染期
 * 抛异常（畸形 API 数据、访问 undefined 等）会一路冒泡成整页白屏（生产 ``next start``
 * 下表现为 "Application error: a client-side exception has occurred"，看不到堆栈），
 * 只能整页刷新恢复。本文件在 app 根路由段捕获错误并降级渲染（保留外层 layout），
 * 附"重试"按钮（调用 reset 重新渲染该路由段）。
 */
export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[app/error]", error, error?.digest ?? "");
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="rounded-md border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
        <div className="font-medium">页面渲染失败</div>
        <div className="mt-1 break-all font-mono text-xs text-red-600/80">
          {asString(error?.message) || "未知错误"}
        </div>
        {error?.digest ? (
          <div className="mt-1 font-mono text-[10px] text-red-500/70">{error.digest}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-100"
      >
        重试
      </button>
    </div>
  );
}
