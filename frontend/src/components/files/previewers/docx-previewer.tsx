"use client";

/**
 * DocxPreviewer — Word（docx）渲染器。
 *
 * 动态 import docx-preview（避免进首屏静态包），renderAsync 渲染进容器。
 * 渲染异常 try/catch 降级为错误态 + 下载引导（R-01）。仅支持 OOXML（docx）。
 *
 * ql-20260825-005：容器 div 必须常驻挂载（loading 态也在 DOM）——旧版 loading
 * 态只渲染 spinner，ref 容器未挂载，effect 里 renderAsync 前置守卫
 * `!containerRef.current` 直接短路，永久卡在「正在渲染」。
 */

import { useEffect, useRef, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";

import { formatFileSize } from "@/lib/file/utils";
import type { PreviewerProps } from "./index";

export function DocxPreviewer({ blob, meta, onDownload }: PreviewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    (async () => {
      try {
        const docxPreview = await import("docx-preview");
        const arrayBuffer = await blob.arrayBuffer();
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        await docxPreview.renderAsync(arrayBuffer, containerRef.current);
        if (!cancelled) setStatus("ok");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "渲染失败");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10 text-error">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-700">Word 文档渲染失败</p>
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

  // 容器常驻（含 loading 态）——effect 的 ref 守卫依赖它在首帧就挂载。
  return (
    <div className="relative min-h-[420px]">
      <div
        ref={containerRef}
        className="docx-preview-container w-full bg-white p-6 text-slate-800"
        data-testid="docx-preview-container"
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-slate-500">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3">正在渲染 Word 文档…</span>
        </div>
      )}
    </div>
  );
}
