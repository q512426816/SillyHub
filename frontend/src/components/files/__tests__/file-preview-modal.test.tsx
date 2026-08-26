/**
 * FilePreviewModal 单测：弹窗壳的 loading / error / 分发 / 下载路径 +
 * 全屏态（2026-08-26-file-fullscreen-preview / FR-01/FR-02）。
 *
 * useObjectUrl 已 mock（直接控制状态），渲染器已 mock（断言分发与 fill 透传）。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { FilePreviewModal, type FilePreviewTarget } from "../file-preview-modal";

// Mock useObjectUrl
const mockUseObjectUrl = vi.fn();
vi.mock("../use-object-url", () => ({
  useObjectUrl: (fetcher: unknown) => mockUseObjectUrl(fetcher),
}));

// Mock 渲染器（仅验证分发）；PdfPreviewer 顺带回显 fill 供透传断言
vi.mock("../previewers", () => ({
  ImagePreviewer: () => <div data-testid="image-previewer" />,
  PdfPreviewer: (props: { fill?: boolean }) => (
    <div data-testid="pdf-previewer" data-fill={props.fill ? "true" : "false"} />
  ),
  DocxPreviewer: () => <div data-testid="docx-previewer" />,
  XlsxPreviewer: () => <div data-testid="xlsx-previewer" />,
  MarkdownPreviewer: () => <div data-testid="markdown-previewer" />,
  HtmlPreviewer: () => <div data-testid="html-previewer" />,
  FallbackPreviewer: () => <div data-testid="fallback-previewer" />,
}));

const mockFetch = vi.fn(() => Promise.resolve(new Blob(["test"], { type: "text/plain" })));
const mockTarget: FilePreviewTarget = {
  fetch: mockFetch,
  meta: { name: "test.pdf", mime: "application/pdf", size: 1024 },
};

/** status=ok + pdf blob 的 useObjectUrl 返回值（分发/全屏用例共用）。 */
function mockOk(blob: Blob) {
  mockUseObjectUrl.mockReturnValue({ blob, url: "blob:mock", status: "ok", retry: vi.fn() });
}

beforeEach(() => {
  mockUseObjectUrl.mockClear();
  mockFetch.mockClear();
});

describe("FilePreviewModal", () => {
  it("target 为 null 或 open 为 false 时不发起拉取", () => {
    mockUseObjectUrl.mockReturnValue({ blob: null, url: null, status: "idle", retry: vi.fn() });
    render(<FilePreviewModal target={null} open onClose={vi.fn()} />);
    render(<FilePreviewModal target={mockTarget} open={false} onClose={vi.fn()} />);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("loading 态显示 spinner", () => {
    mockUseObjectUrl.mockReturnValue({ blob: null, url: null, status: "loading", retry: vi.fn() });
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);
    expect(screen.getByText("正在加载文件…")).toBeInTheDocument();
  });

  it("error 态显示失效文案与重试/关闭按钮", () => {
    mockUseObjectUrl.mockReturnValue({ blob: null, url: null, status: "error", retry: vi.fn() });
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);
    expect(screen.getByText("文件已失效或被清理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新加载/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("pdf blob 分发到 PdfPreviewer", () => {
    const blob = new Blob(["fake-pdf"], { type: "application/pdf" });
    mockUseObjectUrl.mockReturnValue({
      blob,
      url: "blob:mock",
      status: "ok",
      retry: vi.fn(),
    });
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);
    expect(screen.getByTestId("pdf-previewer")).toBeInTheDocument();
  });

  it("标题栏含文件名与元信息", () => {
    mockUseObjectUrl.mockReturnValue({ blob: null, url: null, status: "loading", retry: vi.fn() });
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
    expect(screen.getByText(/PDF/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 KB/)).toBeInTheDocument();
  });

  it("下载按钮存在", () => {
    mockUseObjectUrl.mockReturnValue({ blob: null, url: null, status: "loading", retry: vi.fn() });
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /下载/ })).toBeInTheDocument();
  });

  // ── 全屏态（2026-08-26-file-fullscreen-preview / FR-01/FR-02）──

  it("缺省 defaultFullscreen 时为普通态：全屏按钮文案与 fill=false", () => {
    mockOk(new Blob(["fake-pdf"], { type: "application/pdf" }));
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-previewer")).toHaveAttribute("data-fill", "false");
  });

  it("defaultFullscreen=true 打开即全屏：按钮为退出全屏、fill=true 且锁 body 滚动", () => {
    mockOk(new Blob(["fake-pdf"], { type: "application/pdf" }));
    render(<FilePreviewModal target={mockTarget} open defaultFullscreen onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-previewer")).toHaveAttribute("data-fill", "true");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("点击全屏按钮可来回切换：按钮文案与 fill 随态翻转", () => {
    mockOk(new Blob(["fake-pdf"], { type: "application/pdf" }));
    render(<FilePreviewModal target={mockTarget} open onClose={vi.fn()} />);

    // 普通态 → 全屏
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-previewer")).toHaveAttribute("data-fill", "true");

    // 全屏 → 退出还原普通态（body 滚动同步解锁）
    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-previewer")).toHaveAttribute("data-fill", "false");
    expect(document.body.style.overflow).toBe("");
  });

  it("html blob 分发到 HtmlPreviewer（RENDERER_MAP html 条目）", () => {
    mockOk(new Blob(["<p>hi</p>"], { type: "text/html" }));
    render(
      <FilePreviewModal
        target={{ fetch: mockFetch, meta: { name: "index.html", mime: "text/html", size: 16 } }}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("html-previewer")).toBeInTheDocument();
  });
});

// ── ql-20260826-011：office-config mode=pdf（LibreOffice→PDF）分支 ──

vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => mockApiFetch(...a) }));
const mockApiFetch = vi.fn();

const officeDocxTarget: FilePreviewTarget = {
  fetch: mockFetch,
  meta: { name: "指南.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2048 },
  officeSource: { source: "session_attachment", id: "att-1" },
};

describe("FilePreviewModal office mode=pdf（LibreOffice→PDF）", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockUseObjectUrl.mockReturnValue({ blob: null, url: null, status: "idle", retry: vi.fn() });
    // jsdom 无 createObjectURL/fetch，桩掉
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:mock-pdf");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["pdf"], { type: "application/pdf" })) })),
    );
  });

  it("mode=pdf：office-config 返回 pdf_path → fetch blob → iframe 展示", async () => {
    mockApiFetch.mockResolvedValue({ mode: "pdf", pdf_path: "/api/preview/file/tok" });
    render(<FilePreviewModal target={officeDocxTarget} open onClose={vi.fn()} />);
    const frame = await screen.findByTitle("指南.docx PDF 预览");
    expect(frame).toHaveAttribute("src", "blob:mock-pdf");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/preview/file/tok");
  });

  it("pdf 拉取失败 → 降级本地渲染链（officeFailed）", async () => {
    mockApiFetch.mockResolvedValue({ mode: "pdf", pdf_path: "/api/preview/file/tok" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 410 })));
    render(<FilePreviewModal target={officeDocxTarget} open onClose={vi.fn()} />);
    // 降级后 useObjectUrl 以本地 fetcher 重新挂载（拉 MinIO 原文件），PDF iframe 不出现
    await waitFor(() => expect(mockUseObjectUrl).toHaveBeenLastCalledWith(mockFetch));
    expect(screen.queryByTitle("指南.docx PDF 预览")).not.toBeInTheDocument();
  });
});
