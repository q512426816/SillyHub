"use client";

/**
 * FilePreviewModal — 统一文件预览弹窗壳。
 *
 * antd Modal（FRONTEND_PAGE_STYLE.md §6：弹窗不用 Drawer），标题栏含 FileTypeIcon +
 * 文件名 + 大小/MIME + 全屏切换 + 下载 + 关闭；body 经 useObjectUrl 拉 blob 后按
 * matchRenderer 分发到七渲染器。内置 loading spinner / error 重试态（R-07）。
 *
 * 2026-08-26-file-fullscreen-preview / FR-01/FR-02 / D-004@v1：CSS 伪全屏态——
 * defaultFullscreen 决定 open 时的初始态，工具栏按钮随时切换；全屏下渲染器收
 * fill=true 撑满剩余高度。Esc 不拦截（D-008），保持 antd 默认直接关窗。
 *
 * 依据：design.md §5 数据流 + §7 接口定义。
 */

import { useEffect, useState, type ComponentType } from "react";
import { Modal } from "antd";
import {
  CompressOutlined,
  DownloadOutlined,
  ExpandOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import { apiFetch } from "@/lib/api";
import { FileTypeIcon, formatFileSize } from "@/lib/file/utils";
import { useObjectUrl } from "./use-object-url";
import { matchRenderer } from "./preview-registry";
import {
  HtmlPreviewer,
  ImagePreviewer,
  PdfPreviewer,
  DocxPreviewer,
  XlsxPreviewer,
  MarkdownPreviewer,
  FallbackPreviewer,
  type PreviewerProps,
} from "./previewers";
import { OnlyofficePreviewer } from "./previewers/onlyoffice-previewer";

export interface FilePreviewTarget {
  fetch: () => Promise<Blob>;
  meta: {
    name: string;
    mime?: string | null;
    size?: number | null;
  };
  download?: () => void | Promise<void>;
  /**
   * 2026-08-26-onlyoffice-preview：office 家族文件的可选来源标识——携带时预览窗
   * 先尝试 OnlyOffice 高保真渲染（GET /api/preview/office-config），DS 未启用/
   * 失败自动回落本地渲染器（FR-02 降级链）。不携带 = 恒本地渲染（零回归）。
   */
  officeSource?: {
    source: "session_attachment" | "file";
    id: string;
  };
}

export interface FilePreviewModalProps {
  target: FilePreviewTarget | null;
  open: boolean;
  onClose: () => void;
  /**
   * open 时的初始全屏态（FR-02）：缺省 false = 现状普通态，既有四类入口
   * （attachment-chips/file-message-card/run-file-artifacts/file-viewer）
   * 不传即零回归。打开后用户可经工具栏自由切换；target 切换不重置，
   * 关闭再开重新按本值初始化。
   */
  defaultFullscreen?: boolean;
}

const RENDERER_MAP: Record<string, ComponentType<PreviewerProps>> = {
  image: ImagePreviewer,
  pdf: PdfPreviewer,
  docx: DocxPreviewer,
  xlsx: XlsxPreviewer,
  markdown: MarkdownPreviewer,
  html: HtmlPreviewer,
  fallback: FallbackPreviewer,
};

/**
 * office 家族扩展名（DS 优先尝试集合，含旧格式 doc/xls/ppt）。
 * ql-20260826-013：xls/xlsx 移出——Excel 取消在线渲染（OnlyOffice 退役后无网格
 * 渲染方案），直接走本地链（registry → fallback 下载引导）。
 */
const OFFICE_EXTS = new Set(["doc", "docx", "ppt", "pptx"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

interface OfficeConfigResp {
  /** ql-20260826-011：pdf = Word 走 LibreOffice→PDF（docGrid 排版保真）；ds = OnlyOffice。 */
  mode?: "pdf" | "ds";
  /** mode=pdf：同源一次性 PDF URL（fetch 一次成 blob 再交给 iframe，规避浏览器区间请求重放一次性令牌）。 */
  pdf_path?: string;
  ds_url?: string;
  config?: Record<string, unknown>;
}

/** office 家族 + 携带来源标识 → 尝试 DS（纯函数，供 hook 依赖序使用）。 */
function officeEligibleStatic(t: FilePreviewTarget | null): boolean {
  return Boolean(t?.officeSource && OFFICE_EXTS.has(extOf(t?.meta.name ?? "")));
}

export function FilePreviewModal({
  target,
  open,
  onClose,
  defaultFullscreen = false,
}: FilePreviewModalProps) {
  // ── 全屏态（2026-08-26-file-fullscreen-preview / FR-01/FR-02 / D-004@v1）──
  // CSS 伪全屏（非 Fullscreen API）：open 变 true 时按 defaultFullscreen 初始化；
  // 仅锚定 open/prop，target 切换不重置；关闭再开自然重新初始化。
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (open) setFullscreen(defaultFullscreen);
  }, [open, defaultFullscreen]);

  // 进入全屏锁 body 滚动、退出/卸载还原（agent-log-viewer.tsx L836-842 先例）。
  // antd Modal 打开本身已锁滚动，此处仅兜底嵌套二次弹层场景；open=false 时
  // 立即解锁，防 Esc 直接关窗后 fullscreen 残留 hidden。
  useEffect(() => {
    if (open && fullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, fullscreen]);

  // ── OnlyOffice 前置尝试层（2026-08-26-onlyoffice-preview / FR-01/02）──
  const [officeCfg, setOfficeCfg] = useState<OfficeConfigResp | null>(null);
  const [officeFailed, setOfficeFailed] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const officeEligible = officeEligibleStatic(target) && !officeFailed;

  // ── ql-20260826-011：mode=pdf（LibreOffice 转换）→ 拉 blob 成 objectURL ──
  // ql-20260827-002：渲染交 PdfPreviewer（pdf.js 画布）——iframe+原生查看器在
  // 部分环境不可用（Chrome 对内嵌 blob PDF 报"未能加载"，见 ql-20260827-001）。
  useEffect(() => {
    setPdfBlobUrl(null);
    setPdfBlob(null);
    if (!officeCfg || officeCfg.mode !== "pdf" || !officeCfg.pdf_path) return;
    let cancelled = false;
    let objectUrl = "";
    fetch(officeCfg.pdf_path)
      .then((resp) => {
        if (!resp.ok) throw new Error(`preview pdf HTTP ${resp.status}`);
        return resp.blob();
      })
      .then((raw) => {
        if (cancelled) return;
        // 兜底重打 MIME：octet-stream 的 blob 会被浏览器当下载而非内联渲染
        // （ql-20260826-012，代理层可能丢 Content-Type）。
        const blob = raw.type === "application/pdf" ? raw : new Blob([raw], { type: "application/pdf" });
        objectUrl = URL.createObjectURL(blob);
        setPdfBlob(blob);
        setPdfBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setOfficeFailed(true); // 拉取失败 → 降级本地渲染器
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [officeCfg]);

  // DS 路径不需要本地 blob（DS 容器自拉一次性 URL）；officeFailed 降级瞬间
  // fetcher 重新挂载拉取本地对象（useObjectUrl 依赖变化自然重跑）。
  const { blob, url, status, retry } = useObjectUrl(
    open && target && !officeEligible ? target.fetch : null,
  );

  useEffect(() => {
    setOfficeCfg(null);
    setOfficeFailed(false);
    if (!open || !officeEligibleStatic(target) || !target?.officeSource) return;
    let cancelled = false;
    // 预取 DS 配置：503（未启用）/任何失败 → officeFailed（降级本地渲染）。
    apiFetch<OfficeConfigResp>(
      `/api/preview/office-config?source=${target.officeSource.source}&id=${target.officeSource.id}`,
    )
      .then((resp) => {
        if (!cancelled) setOfficeCfg(resp);
      })
      .catch(() => {
        if (!cancelled) setOfficeFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // officeEligible 不进依赖（含 officeFailed 会自激振荡）；以静态资格 + 标识为锚。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.officeSource?.source, target?.officeSource?.id, target?.meta.name]);

  const handleDownload = () => {
    if (target?.download) {
      void target.download();
    } else if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = target?.meta.name ?? "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const renderBody = () => {
    if (!target) return null;

    // OnlyOffice 高保真优先：配置就绪 → DS 渲染；预取中 → 轻加载态；失败 → 落回下方本地链。
    if (officeEligible && !officeFailed) {
      // ql-20260826-011：Word → LibreOffice→PDF（本地 docxjs 无分页模型，公文
      // 目录/封面必漂移；PDF 保真）。ql-20260827-002：交 PdfPreviewer（pdf.js
      // 画布）渲染——原生查看器对内嵌 blob PDF 不可依赖（ql-20260827-001）。
      if (officeCfg?.mode === "pdf") {
        if (pdfBlobUrl) {
          return (
            <PdfPreviewer
              blob={pdfBlob ?? new Blob()}
              url={pdfBlobUrl}
              meta={target.meta}
              onDownload={handleDownload}
              fill={fullscreen}
            />
          );
        }
        return (
          <div className="flex min-h-[420px] items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <span className="ml-3 text-slate-500">正在转换为 PDF 视图…（首次约需数秒，之后走缓存）</span>
          </div>
        );
      }
      if (officeCfg && officeCfg.ds_url && officeCfg.config) {
        return (
          <OnlyofficePreviewer
            blob={blob ?? new Blob()}
            url={url ?? ""}
            meta={target.meta}
            onDownload={handleDownload}
            officeConfig={{ ds_url: officeCfg.ds_url, config: officeCfg.config }}
            onFallback={() => setOfficeFailed(true)}
            fill={fullscreen}
          />
        );
      }
      return (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-slate-500">正在准备高保真预览…</span>
        </div>
      );
    }

    if (status === "loading") {
      return (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-slate-500">正在加载文件…</span>
        </div>
      );
    }

    if (status === "error") {
      return (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">文件已失效或被清理</p>
          <p className="max-w-md text-xs text-slate-500">
            附件可能已被删除或草稿已过期。可尝试重新加载，或关闭后重新上传。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              <ReloadOutlined />
              重新加载
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              关闭
            </button>
          </div>
        </div>
      );
    }

    if (!blob || !url) return null;

    const rendererKey = matchRenderer(blob.type ?? target.meta.mime, target.meta.name);
    const Renderer = RENDERER_MAP[rendererKey] ?? FallbackPreviewer;

    return (
      <Renderer
        blob={blob}
        url={url}
        meta={target.meta}
        onDownload={handleDownload}
        fill={fullscreen}
      />
    );
  };

  const mimeLabel = target?.meta.mime?.split("/").pop()?.toUpperCase() ?? "";
  const sizeLabel = target?.meta.size != null ? formatFileSize(target.meta.size) : "";
  const metaText = [mimeLabel, sizeLabel].filter(Boolean).join(" · ");

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={fullscreen ? "100vw" : "min(960px, 94vw)"}
      // 全屏需一并覆盖 .ant-modal 根默认的 top:100 与 max-width: calc(100vw-32px)
      // （antd v6 中 width 挂根节点 style，但被默认 max-width 截窄）。普通态不传 style。
      style={fullscreen ? { top: 0, maxWidth: "100vw" } : undefined}
      styles={
        fullscreen
          ? {
              // container = 可见白盒（antd v6 语义键）：撑满视口、圆角清零，
              // flex 纵向布局让 body 拿到剩余高度（header 自然高）。
              container: {
                height: "100vh",
                borderRadius: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              },
              // body 纵向 flex-1：工具栏自然高 + 预览区 flex-1 撑满剩余（R-02 单滚动）。
              body: {
                padding: 0,
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              },
            }
          : // 普通态与现状完全一致（零回归）。
            { body: { padding: 0 } }
      }
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <FileTypeIcon mime={target?.meta.mime ?? ""} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800" title={target?.meta.name}>
              {target?.meta.name}
            </div>
            {metaText && <div className="font-mono text-[11px] text-slate-500">{metaText}</div>}
          </div>
        </div>
      }
    >
      <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
        {/* 全屏切换（D-004@v1 CSS 伪全屏）：唯一退出全屏入口——Esc 走 antd 默认
            直接关窗不拦截（D-008），故不注册任何 keydown 监听。置于下载按钮左侧。 */}
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          aria-label={fullscreen ? "退出全屏" : "全屏"}
        >
          {fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
          {fullscreen ? "退出全屏" : "全屏"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
          aria-label={`下载 ${target?.meta.name}`}
        >
          <DownloadOutlined />
          下载
        </button>
      </div>
      {/* 普通态维持 max-h-[calc(100vh-220px)] 不变；全屏态改 flex-1 撑满
          （container/body 已是纵向 flex，min-h-0 防内容撑破）。 */}
      <div className={fullscreen ? "min-h-0 flex-1 overflow-auto" : "max-h-[calc(100vh-220px)] overflow-auto"}>
        {renderBody()}
      </div>
    </Modal>
  );
}
