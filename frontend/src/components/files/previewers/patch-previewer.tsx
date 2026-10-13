"use client";

/**
 * PatchPreviewer — unified diff 渲染器（ql-20260917-004）。
 *
 * scope-audit.patch / quicklog patches 等统一 diff 文本：DiffView 共享
 * 红绿渲染（parseUnifiedDiff + 行号）；非 diff 格式由 DiffView 内部回落
 * 纯文本。change.patch（2026-10-13-change-files-view-polish）全屏转发
 * 按文件折叠树（PatchTreeView 与内联 change-file-tree 同源，FR-04 不做
 * 两套）；无 diff --git 头回落 DiffView。统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";

import { DiffView, PatchTreeView, tryParsePatchFiles } from "@/components/files/structured-views";
import type { PreviewerProps } from "./index";

export function PatchPreviewer({ blob, meta, fill }: PreviewerProps) {
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
        <span className="ml-3">正在读取 diff…</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">diff 读取失败</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
      </div>
    );
  }

  const wrap = fill ? "flex h-full min-h-[420px] w-full flex-col p-4" : "flex max-h-[60vh] w-full flex-col p-4";
  // change.patch 全屏走按文件折叠树（与内联同源）；无 diff --git 头回落 DiffView
  const sections =
    (meta.name.split("/").pop() ?? meta.name) === "change.patch" && text !== null
      ? tryParsePatchFiles(text)
      : null;
  if (sections !== null) {
    return (
      <div className={wrap}>
        <PatchTreeView sections={sections} />
      </div>
    );
  }
  return (
    <div className={wrap}>
      <DiffView content={text ?? ""} />
    </div>
  );
}
