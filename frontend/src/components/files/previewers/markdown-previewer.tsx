"use client";

/**
 * MarkdownPreviewer — Markdown（md）渲染器。
 *
 * 安全红线（D-006@v1）：必须经 ui/markdown-text.tsx 渲染（自带 rehype-sanitize
 * + MARKDOWN_SANITIZE_SCHEMA + ssr:false），禁止裸用 @uiw/react-markdown-preview
 * 直出不可信内容（存储型 XSS 防线）。
 *
 * 统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";

import { MarkdownText } from "@/components/ui/markdown-text";
import { formatFileSize } from "@/lib/file/utils";
import type { PreviewerProps } from "./index";

export function MarkdownPreviewer({ blob, meta, onDownload }: PreviewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    blob.text()
      .then((text: string) => {
        if (!cancelled) {
          setContent(text);
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
        <span className="ml-3">正在读取 Markdown…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Markdown 读取失败</p>
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

  return (
    <div className="min-h-[420px] w-full p-6">
      <MarkdownText content={content ?? ""} className="min-w-0" />
    </div>
  );
}
