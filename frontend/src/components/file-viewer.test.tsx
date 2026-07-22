// task-10: FileViewer 组件单测 (平台级文件中心, 2026-07-22)。
//
// 覆盖 (FR-7/FR-8):
//   1. 空 fileIds → 「暂无附件」
//   2. 图片 → 渲染缩略图 (img src = 下载直链)
//   3. 非图片 → 渲染文件名 + 下载链接 (href = 下载直链)
//   4. 混合 → 图片与非图片各自归位
//
// 边界: mock @/lib/file/api;antd Image 的放大预览交互由人工 e2e 覆盖,
// 这里只验证缩略图/下载链接渲染与 MIME 归类。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { FileViewer } from "@/components/file-viewer";
import type { FileMetaResp } from "@/lib/file/api";

vi.mock("@/lib/file/api", () => ({
  fetchFileMetaBatch: vi.fn(),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
}));

import { fetchFileMetaBatch } from "@/lib/file/api";
const fetchMetaMock = vi.mocked(fetchFileMetaBatch);

const IMG: FileMetaResp = {
  id: "img-1",
  original_name: "照片.jpg",
  mime_type: "image/jpeg",
  size: 1024,
  owner_type: "ppm_problem",
  owner_id: null,
};
const PDF: FileMetaResp = {
  id: "doc-1",
  original_name: "说明书.pdf",
  mime_type: "application/pdf",
  size: 4096,
  owner_type: "ppm_problem",
  owner_id: null,
};

describe("FileViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("空 fileIds → 暂无附件", () => {
    render(<FileViewer fileIds={[]} />);
    expect(screen.getByText("暂无附件")).toBeTruthy();
    expect(fetchMetaMock).not.toHaveBeenCalled();
  });

  it("图片 → 渲染缩略图(下载直链)", async () => {
    fetchMetaMock.mockResolvedValue([IMG]);
    const { container } = render(<FileViewer fileIds={["img-1"]} />);
    await waitFor(() => {
      const img = container.querySelector('img[src="/api/file/img-1"]');
      expect(img).toBeTruthy();
    });
  });

  it("非图片 → 文件名 + 下载链接(下载直链)", async () => {
    fetchMetaMock.mockResolvedValue([PDF]);
    render(<FileViewer fileIds={["doc-1"]} />);
    await waitFor(() => expect(screen.getByText("说明书.pdf")).toBeTruthy());
    const link = screen.getByLabelText("下载 说明书.pdf") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/file/doc-1");
  });

  it("混合 → 图片与非图片各自归位", async () => {
    fetchMetaMock.mockResolvedValue([IMG, PDF]);
    const { container } = render(<FileViewer fileIds={["img-1", "doc-1"]} />);
    await waitFor(() => expect(screen.getByText("说明书.pdf")).toBeTruthy());
    expect(container.querySelector('img[src="/api/file/img-1"]')).toBeTruthy();
    expect(screen.getByLabelText("下载 说明书.pdf")).toBeTruthy();
  });
});
