"use client";

/**
 * JsonPreviewer — JSON 渲染器（ql-20260917-004/010）。
 *
 * blob.text() → tryParseJson → 三个固定结构报告文件（scope-audit/
 * apply-manifest/verify-facts，按 meta.name 分发）走表格摘要视图，其余
 * 合法 json 走 JsonView 折叠树；解析失败回落纯文本。
 * 统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";

import { JsonlPreviewer } from "./jsonl-previewer";
import { JsonView, knownJsonView, tryParseJson } from "@/components/files/structured-views";
import type { PreviewerProps } from "./index";

/**
 * jsonl 文件名兜底转发（2026-09-29-change-detail-timeline-files-polish）：后端
 * guess_type 对 .jsonl 在部分平台返回 application/json——mime 优先级高于扩展名
 * 导致 jsonl 绕过 EXT_MAP 命中本渲染器；整体 parse 必失败，不转发会落纯文本，
 * 结构化预览失效。分发放在壳组件（hooks 全在 JsonPreviewerBody 内，壳不持有
 * hooks——提前 return 不违反 rules-of-hooks）。
 */
export function JsonPreviewer(props: PreviewerProps) {
  if (props.meta.name.toLowerCase().endsWith(".jsonl")) {
    return <JsonlPreviewer {...props} />;
  }
  return <JsonPreviewerBody {...props} />;
}

function JsonPreviewerBody({ blob, meta, fill }: PreviewerProps) {
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
  // 三个固定结构报告文件（按文件名分发）走表格摘要视图，其余走折叠树
  const known = parsed !== null ? knownJsonView(meta.name, parsed) : null;
  return (
    <div className={wrap}>
      {known ?? (parsed !== null ? (
        <JsonView value={parsed} />
      ) : (
        // 非法 JSON：纯文本兜底（json 扩展名不保证内容合法）
        <pre className="min-w-0 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
      ))}
    </div>
  );
}
