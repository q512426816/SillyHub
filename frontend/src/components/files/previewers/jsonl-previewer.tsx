"use client";

/**
 * JsonlPreviewer — JSONL 渲染器（2026-09-29-change-detail-timeline-files-polish）。
 *
 * blob.text() → tryParseJsonl → watcher-events.jsonl（按 meta.name 分发）走
 * 专用表格视图，其余合法 jsonl 走 JsonlView 逐行折叠树；任一行非法回落纯文本。
 * 统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";

import { JsonlView, knownJsonlView, tryParseJsonl } from "@/components/files/structured-views";
import type { PreviewerProps } from "./index";

export function JsonlPreviewer({ blob, meta, fill }: PreviewerProps) {
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
        <span className="ml-3">正在读取 JSONL…</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">JSONL 读取失败</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
      </div>
    );
  }

  const lines = text !== null ? tryParseJsonl(text) : null;
  const wrap = fill ? "h-full min-h-[420px] w-full overflow-auto p-4" : "max-h-[60vh] w-full overflow-auto p-4";
  const known = lines !== null ? knownJsonlView(meta.name, lines) : null;
  return (
    <div className={wrap} data-testid="jsonl-previewer">
      {known ?? (lines !== null ? (
        <JsonlView lines={lines} />
      ) : (
        // 非法 JSONL：纯文本兜底（jsonl 扩展名不保证逐行合法）
        <pre className="min-w-0 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
      ))}
    </div>
  );
}
