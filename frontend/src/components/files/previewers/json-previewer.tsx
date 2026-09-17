"use client";

/**
 * JsonPreviewer — JSON 渲染器（ql-20260917-004）。
 *
 * blob.text() → tryParseJson → JsonView（共享结构化视图：折叠/着色）；
 * 解析失败回落纯文本（json 扩展名不保证内容合法）。
 * 统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";

import { JsonView, tryParseJson } from "@/components/files/structured-views";
import type { PreviewerProps } from "./index";

export function JsonPreviewer({ blob, fill }: PreviewerProps) {
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
        <span className="ml-3">正在读取 JSON…</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">JSON 读取失败</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
      </div>
    );
  }

  const parsed = text !== null ? tryParseJson(text) : null;
  const wrap = fill ? "h-full min-h-[420px] w-full overflow-auto p-4" : "max-h-[60vh] w-full overflow-auto p-4";
  return (
    <div className={wrap}>
      {parsed !== null ? (
        <JsonView value={parsed} />
      ) : (
        // 非法 JSON：纯文本兜底（json 扩展名不保证内容合法）
        <pre className="min-w-0 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
      )}
    </div>
  );
}
