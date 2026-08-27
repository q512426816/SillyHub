"use client";

/**
 * PdfPreviewer — PDF 渲染器（pdf.js 画布版，ql-20260827-001）。
 *
 * ql-20260825-005 曾用 iframe + 原生查看器（含移动端 fill 态高度适配）；ql-20260827-001
 * 环境（嵌入式 Chromium 无 PDF 组件 / 原生查看器对个别文档报"未能加载"）不可用，
 * 改 pdf.js 画布渲染——纯 JS 解析绘制，不依赖任何浏览器插件。
 *
 * 双 effect 解耦：解析（url → doc）与绘制（status=ok 后容器已挂载可测宽）分离，
 * 避免 setStatus 异步提交期 containerRef 为 null 导致页渲染被跳过。
 *
 * worker 从 /pdf.worker.min.mjs 静态取（webpack 对 node_modules 内 worker 的
 * URL 资源化不可靠）；升级 pdfjs-dist 时须同步重拷该文件到 public/。
 */

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { PreviewerProps } from "./index";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/** 超过该页数只渲染前 N 页（防数百页大文档画布爆内存，完整内容走下载）。 */
const MAX_RENDER_PAGES = 50;

export function PdfPreviewer({ url, fill }: PreviewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ok">("loading");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);

  // ── 解析：url → doc（失败 error 态）──
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setStatus("loading");
    setDoc(null);
    setNumPages(0);

    pdfjs
      .getDocument({ url, isEvalSupported: false })
      .promise.then((d) => {
        if (cancelled) {
          void d.destroy();
          return;
        }
        setDoc(d);
        setNumPages(d.numPages);
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // 组件卸载时销毁文档（释放 worker 侧解析缓存）。
  useEffect(() => {
    return () => {
      void doc?.destroy();
    };
  }, [doc]);

  // ── 绘制：status=ok 提交后容器已挂载可见，可量宽 ──
  useEffect(() => {
    if (status !== "ok" || !doc) return;
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const renderPages = Math.min(doc.numPages, MAX_RENDER_PAGES);
      const baseWidth = Math.max(container.clientWidth - 16, 320);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= renderPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: (baseWidth / base.width) * dpr,
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.display = "block";
        const wrap = document.createElement("div");
        wrap.className = "mb-3 overflow-hidden rounded-lg border border-border";
        wrap.appendChild(canvas);
        container.appendChild(wrap);
        await page.render({
          canvasContext: canvas.getContext("2d")!,
          viewport,
        }).promise;
      }
    })();

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [status, doc]);

  return (
    <div className={fill ? "flex h-full w-full flex-col" : "flex h-[70vh] w-full flex-col"}>
      {status === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-slate-500">正在渲染 PDF…</span>
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm font-semibold text-slate-700">PDF 渲染失败</p>
          <p className="text-xs text-slate-500">
            文件可能已损坏或加密，可尝试下载后用本机 PDF 阅读器打开。
          </p>
        </div>
      )}
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto rounded-lg bg-slate-100 p-2 ${
          status === "ok" ? "" : "hidden"
        }`}
        data-testid="pdf-pages"
      >
        {/* 页画布由 pdf.js 顺序追加 */}
      </div>
      {status === "ok" && numPages > MAX_RENDER_PAGES && (
        <div className="py-1.5 text-center text-xs text-slate-500">
          文档共 {numPages} 页，在线渲染前 {MAX_RENDER_PAGES} 页，完整内容请下载查看
        </div>
      )}
    </div>
  );
}
