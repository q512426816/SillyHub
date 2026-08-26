/**
 * OnlyOffice 预览链路测试（2026-08-26-onlyoffice-preview，FR-01/02）。
 *
 * 覆盖：
 * 1. FilePreviewModal：office 家族 + officeSource → 预取 config 成功 → DS 渲染器挂载；
 * 2. 降级：config 请求失败（503）→ 自动回落本地渲染器（docx→DocxPreviewer）；
 * 3. pptx（仅 DS 能渲染）：config 失败 → FallbackPreviewer（下载引导）；
 * 4. xls/xlsx 不再发起 office 尝试 → 直接 fallback 下载引导（ql-20260826-013）；
 * 5. 非 office 文件（png）不触发 config 预取（零回归锚点）。
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { FilePreviewModal } from "../file-preview-modal";

// Mock apiFetch（office-config 预取通道）。
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

// Mock 本地渲染器（断言降级目标）+ OnlyofficePreviewer（断言 DS 路径）。
vi.mock("../previewers", () => ({
  ImagePreviewer: () => <div data-testid="image-previewer" />,
  PdfPreviewer: () => <div data-testid="pdf-previewer" />,
  DocxPreviewer: () => <div data-testid="docx-previewer" />,
  XlsxPreviewer: () => <div data-testid="xlsx-previewer" />,
  MarkdownPreviewer: () => <div data-testid="markdown-previewer" />,
  FallbackPreviewer: () => <div data-testid="fallback-previewer" />,
}));
vi.mock("../previewers/onlyoffice-previewer", () => ({
  OnlyofficePreviewer: () => <div data-testid="onlyoffice-previewer" />,
}));
// useObjectUrl：office 成功路径不需要 blob，直接 ok 态（降级路径才拉本地）。
vi.mock("../use-object-url", () => ({
  useObjectUrl: (fetcher: unknown) => ({
    blob: fetcher ? new Blob(["x"]) : null,
    url: fetcher ? "blob:mock" : null,
    status: fetcher ? "ok" : "idle",
    retry: vi.fn(),
  }),
}));

const mockBlob = new Blob(["x"], { type: "application/octet-stream" });

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FilePreviewModal OnlyOffice 链路（2026-08-26）", () => {
  it("office 家族 + config 成功 → DS 渲染器挂载（FR-01）", async () => {
    apiFetchMock.mockResolvedValue({
      mode: "ds",
      ds_url: "http://127.0.0.1:8080",
      config: { document: { fileType: "docx" } },
    });
    render(
      <FilePreviewModal
        target={{
          fetch: () => Promise.resolve(mockBlob),
          meta: { name: "指南.docx" },
          officeSource: { source: "session_attachment", id: "att-1" },
        }}
        open
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-previewer")).toBeInTheDocument();
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/preview/office-config?source=session_attachment&id=att-1",
    );
  });

  it("config 失败（DS 未启用 503）→ 降级本地 DocxPreviewer（FR-02）", async () => {
    apiFetchMock.mockRejectedValue(new Error("503"));
    render(
      <FilePreviewModal
        target={{
          fetch: () => Promise.resolve(mockBlob),
          meta: { name: "指南.docx" },
          officeSource: { source: "session_attachment", id: "att-1" },
        }}
        open
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("docx-previewer")).toBeInTheDocument();
    });
  });

  it("pptx config 失败 → FallbackPreviewer（仅 DS 能渲染的格式降级为下载引导）", async () => {
    apiFetchMock.mockRejectedValue(new Error("503"));
    render(
      <FilePreviewModal
        target={{
          fetch: () => Promise.resolve(mockBlob),
          meta: { name: "汇报.pptx" },
          officeSource: { source: "file", id: "f-1" },
        }}
        open
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("fallback-previewer")).toBeInTheDocument();
    });
  });

  it("xls 不触发 config 预取 → 直接 FallbackPreviewer（ql-20260826-013：Excel 取消在线渲染）", async () => {
    render(
      <FilePreviewModal
        target={{
          fetch: () => Promise.resolve(mockBlob),
          meta: { name: "考核.xls" },
          officeSource: { source: "session_attachment", id: "att-2" },
        }}
        open
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("fallback-previewer")).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("非 office 文件不触发 config 预取（零回归锚点）", async () => {
    render(
      <FilePreviewModal
        target={{
          fetch: () => Promise.resolve(mockBlob),
          meta: { name: "图.png", mime: "image/png" },
          officeSource: { source: "file", id: "f-2" },
        }}
        open
        onClose={vi.fn()}
      />,
    );
    // png 直接本地渲染（ImagePreviewer），office-config 未被调用。
    expect(screen.getByTestId("image-previewer")).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
