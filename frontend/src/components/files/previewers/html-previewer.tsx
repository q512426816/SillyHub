"use client";

/**
 * HtmlPreviewer — HTML（交互原型）渲染器（2026-08-26-file-fullscreen-preview）。
 *
 * blob.text() 异步读出内容后经 iframe srcDoc 渲染，原型里的脚本可跑。
 * 安全红线（D-005@v1）：sandbox 只给 allow-scripts allow-popups、不设
 * allow-same-origin——iframe 被当作唯一源，脚本无法访问父页面
 * cookie/storage/DOM，与 change-file-tree 内联 HTML 预览同款隔离策略。
 * 统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";

import { formatFileSize } from "@/lib/file/utils";
import type { PreviewerProps } from "./index";

export function HtmlPreviewer({ blob, meta, onDownload, fill }: PreviewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // cancelled 兼防卸载与 blob 切换竞态（旧读数晚到不得覆盖新状态）
    let cancelled = false;
    setStatus("loading");
    setError(null);

    blob
      .text()
      .then((text: string) => {
        if (!cancelled) {
          setHtml(text);
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
        <span className="ml-3">正在读取 HTML…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">HTML 读取失败</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <DownloadOutlined />
            下载文件（{formatFileSize(meta.size ?? 0)}）
          </button>
        )}
      </div>
    );
  }

  // fill 态 h-full 撑满全屏 body；非 fill 固定视口高（与 PdfPreviewer 一致——
  // 普通 Modal body 高度 auto 的父链上百分比高解析不了，iframe 会塌成默认高）
  return (
    <div
      className={`w-full overflow-hidden rounded-md border border-border bg-card ${
        fill ? "h-full" : "h-[70vh]"
      }`}
    >
      <iframe
        title={`${meta.name} 渲染预览`}
        srcDoc={html ?? ""}
        // sandbox 不设 allow-same-origin：iframe 被当作唯一源，
        // 脚本可跑（交互原型可见）但无法访问父页面 cookie/storage/DOM，安全隔离。
        sandbox="allow-scripts allow-popups"
        className="h-full w-full border-0 bg-card"
      />
    </div>
  );
}
