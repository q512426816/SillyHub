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

export function OnlyofficePreviewer({ officeConfig, onFallback }: OnlyofficePreviewerProps) {
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
        const editor = new window.DocsAPI.DocEditor(holderRef.current.id, {
          ...officeConfig.config,
          width: "100%",
          height: "100%",
          events: {
            // DS 约定：容器由脚本就地替换为 iframe，本组件只保留占位 div。
            onError: () => fallbackRef.current(),
          },
        });
        editorRef.current = editor;
        // 兜底超时：onError 不总是触发（如 DS 起一半），20s 无 iframe 视为失败。
        destroyTimer = setTimeout(() => {
          if (
            !cancelled &&
            holderRef.current &&
            !holderRef.current.querySelector("iframe")
          ) {
            fallbackRef.current();
          }
        }, 20_000);
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
    <div className="h-[74vh] w-full bg-white">
      <div ref={holderRef} id="onlyoffice-editor-holder" className="h-full w-full" />
    </div>
  );
}
