"use client";

import { useEffect } from "react";

import { asString } from "@/lib/utils";

/**
 * F1（健壮性，2026-07-24）：全局错误边界——捕获 root layout 自身抛出的异常。
 *
 * 与 ``app/error.tsx`` 不同：``global-error`` 替换整个 root layout，必须自行渲染
 * ``<html><body>``。当 ``AntdRegistry`` / ``AntdProviders`` / ``AppProviders`` 或
 * root layout 渲染期抛异常时，``app/error.tsx`` 不生效（它依赖 root layout 仍能渲染），
 * 此处兜底避免彻底白屏。此时 globals.css / tailwind 尚未加载，故用内联样式。
 * 参考 Next.js 文档：app/global-error.tsx。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[app/global-error]", error, error?.digest ?? "");
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            gap: 12,
            padding: 32,
            textAlign: "center",
            color: "#b91c1c",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16 }}>应用发生严重错误</div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              color: "#dc2626",
              wordBreak: "break-all",
              maxWidth: 720,
            }}
          >
            {asString(error?.message) || "未知错误"}
          </div>
          {error?.digest ? (
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#ef4444" }}>
              {error.digest}
            </div>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              border: "1px solid #fca5a5",
              background: "#fff",
              color: "#b91c1c",
              padding: "4px 12px",
              fontSize: 12,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
