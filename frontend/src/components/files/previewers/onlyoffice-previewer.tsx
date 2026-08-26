"use client";

/**
 * OnlyofficePreviewer — OnlyOffice DS 高保真渲染器（2026-08-26-onlyoffice-preview）。
 *
 * 动态加载 DS 的 api.js（仅 office 预览时）→ DocsAPI.DocEditor 只读渲染。
 * 免 npm 包（D-003）：DocsAPI 全局 + 自写最小类型。
 * 降级链（FR-02）：api.js 加载失败 / DocEditor onError / 超时 → onFallback()
 * （上层切回本地渲染器——config 端点 503 时上层根本不会进本组件）。
 */

import { useEffect, useRef } from "react";

import type { PreviewerProps } from "./index";

/** DS api.js 暴露的全局（仅本文件使用，最小声明）。 */
declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        id: string,
        config: Record<string, unknown> & {
          events?: {
            onError?: (e: unknown) => void;
            onDocumentReady?: () => void;
          };
        },
      ) => { destroyEditor: () => void };
    };
  }
}

/** 同源 DS api.js 单飞加载（重复预览不重复注入）。 */
const scriptLoads = new Map<string, Promise<void>>();

function loadDsApi(dsUrl: string): Promise<void> {
  const url = `${dsUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`;
  let p = scriptLoads.get(url);
  if (p) return p;
  p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoads.delete(url);
      reject(new Error("api.js 加载失败"));
    };
    document.head.appendChild(s);
  });
  scriptLoads.set(url, p);
  return p;
}

export interface OnlyofficePreviewerProps extends PreviewerProps {
  /** GET /api/preview/office-config 响应。 */
  officeConfig: { ds_url: string; config: Record<string, unknown> };
  /** 任一失败（加载/初始化/编辑器错误）→ 上层切回本地渲染器。 */
  onFallback: () => void;
}

export function OnlyofficePreviewer({ officeConfig, onFallback, fill }: OnlyofficePreviewerProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  useEffect(() => {
    let cancelled = false;
    let destroyTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        await loadDsApi(officeConfig.ds_url);
        if (cancelled || !window.DocsAPI || !holderRef.current) return;
        // config 整体来自后端签名（width/height 已含——DS 9 严格 JWT 校验提交
        // config 字段须被 token 覆盖，此处仅追加 events 回调（DS 校验忽略）。
        const editor = new window.DocsAPI.DocEditor(holderRef.current.id, {
          ...officeConfig.config,
          events: {
            onError: () => fallbackRef.current(),
            // DS 9 约定：holder div 被就地替换为 iframe（asc-word{N}），挂载成功
            // 即取消兜底超时（ql-20260826-002：旧检查在 holder 内找 iframe 而 DS
            // 是替换式挂载——恒 false，20s 后误判降级，出现「先 DS 后回落」）。
            onDocumentReady: () => {
              if (destroyTimer) clearTimeout(destroyTimer);
            },
          },
        });
        editorRef.current = editor;
        // 兜底超时（60s，首开含 DS 冷启动换页）：onDocumentReady 已取消；超时以
        // 「父容器内出现了 DS 替换节点（iframe/asc 容器）」为成功信号。
        destroyTimer = setTimeout(() => {
          if (cancelled || !holderRef.current) return;
          const parent = holderRef.current.parentElement;
          const mounted =
            (parent && parent.querySelector("iframe")) ||
            document.getElementById(holderRef.current.id) === null; // holder 已被替换
          if (!mounted) fallbackRef.current();
        }, 60_000);
      } catch {
        if (!cancelled) fallbackRef.current();
      }
    })();

    return () => {
      cancelled = true;
      if (destroyTimer) clearTimeout(destroyTimer);
      try {
        editorRef.current?.destroyEditor();
      } catch {
        /* destroy 幂等容错 */
      }
      editorRef.current = null;
    };
  }, [officeConfig]);

  return (
    <div className={fill ? "h-full w-full bg-white" : "h-[74vh] w-full bg-white"}>
      <div ref={holderRef} id="onlyoffice-editor-holder" className="h-full w-full" />
    </div>
  );
}
