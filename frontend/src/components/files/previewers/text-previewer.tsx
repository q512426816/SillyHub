"use client";

/**
 * TextPreviewer — 纯文本渲染器（ql-20260917-004）。
 *
 * .log / .txt 等文本文件此前全屏预览落 fallback 下载卡片；此渲染器按
 * 等宽字体直出（长行折行——全屏弹窗内横向滚动看日志体验差）。统一消费
 * PreviewerProps。
 */

import { useEffect, useState } from "react";

import type { PreviewerProps } from "./index";

export function TextPreviewer({ blob, fill }: PreviewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    blob
      .text()
      .then((t: string) => {
        if (!cancelled) {
          setText(t);
          setStatus("ok");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "读取失败");
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[420px] items-center justify-center p-8 text-slate-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <span className="ml-3">正在读取文本…</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">文本读取失败</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
      </div>
    );
  }

  const wrap = fill ? "h-full min-h-[420px] w-full overflow-auto p-4" : "max-h-[60vh] w-full overflow-auto p-4";
  return (
    <pre
      data-testid="text-previewer"
      className={`min-w-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words ${wrap}`}
    >
      {text || "（空文件）"}
    </pre>
  );
}
