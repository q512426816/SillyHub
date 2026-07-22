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
  fetchFileBlob: vi.fn(() => Promise.resolve(new Blob(["x"], { type: "image/jpeg" }))),
  downloadFile: vi.fn(() => Promise.resolve()),
}));

// FileImage 的 fetch-blob→objectURL 逻辑在 file-upload.test 间接覆盖；
// 此处 mock 成透传 img，专注测 FileViewer 的 MIME 归类/布局（jsdom 下 antd Image
// 卡 loading 不渲染 img，见 frontend-markdown-text-jsdom-null 经验）。
vi.mock("@/components/file-image", () => ({
  FileImage: (props: { id: string; alt?: string; preview?: boolean }) => (
    <img alt={props.alt} data-file-id={props.id} data-preview={props.preview ? "1" : "0"} />
  ),
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

  it("图片 → FileImage 带 token 取 blob 渲染缩略图", async () => {
    fetchMetaMock.mockResolvedValue([IMG]);
    const { container } = render(<FileViewer fileIds={["img-1"]} />);
    await waitFor(() => {
      // FileImage 经 fetchFileBlob(带 Authorization)取 blob → objectURL 渲染 img，
      // src 是 blob: URL（非裸下载链），用 alt 锁定。
      expect(container.querySelector('img[alt="照片.jpg"]')).toBeTruthy();
    });
  });

  it("非图片 → 文件名 + 下载链接(onClick 调 downloadFile 带 token)", async () => {
    fetchMetaMock.mockResolvedValue([PDF]);
    render(<FileViewer fileIds={["doc-1"]} />);
    await waitFor(() => expect(screen.getByText("说明书.pdf")).toBeTruthy());
    // 下载改 downloadFile（fetch 带 token），Link 无 href，靠 aria-label 定位
    expect(screen.getByLabelText("下载 说明书.pdf")).toBeTruthy();
  });

  it("混合 → 图片与非图片各自归位", async () => {
    fetchMetaMock.mockResolvedValue([IMG, PDF]);
    const { container } = render(<FileViewer fileIds={["img-1", "doc-1"]} />);
    await waitFor(() => expect(screen.getByText("说明书.pdf")).toBeTruthy());
    expect(container.querySelector('img[alt="照片.jpg"]')).toBeTruthy();
    expect(screen.getByLabelText("下载 说明书.pdf")).toBeTruthy();
  });
});
