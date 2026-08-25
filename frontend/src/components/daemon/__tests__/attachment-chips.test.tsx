/**
 * attachment-chips 交互测试：全部 chip 可点击弹预览窗（FR-01）。
 *
 * mock FilePreviewModal 与 fetchAttachmentBlob，断言点击触发打开预览。
 */

import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AttachmentChips } from "../attachment-chips";

// Mock FilePreviewModal（保留渲染状态供断言）
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: ({ open }: { open: boolean }) => (
    <div data-testid="file-preview-modal" data-open={open} />
  ),
}));

// Mock fetchAttachmentBlob
vi.mock("@/lib/api/session-attachments", () => ({
  fetchAttachmentObjectUrl: vi.fn(() => Promise.resolve("blob:mock")),
  fetchAttachmentBlob: vi.fn(() => Promise.resolve(new Blob(["test"]))),
}));

const mockAttachments = [
  { id: "img-1", kind: "image" as const, name: "截图.png" },
  { id: "doc-1", kind: "file" as const, name: "文档.docx" },
  { id: "doc-2", kind: "file" as const, name: "报告.pdf" },
];

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

describe("AttachmentChips", () => {
  it("文件 chip 可点击并触发预览", () => {
    render(<AttachmentChips attachments={mockAttachments} />);
    const fileChip = screen.getByText("文档.docx").closest("button");
    expect(fileChip).toBeInTheDocument();
    act(() => {
      fileChip?.click();
    });
    const modal = document.querySelector("[data-testid='file-preview-modal']");
    expect(modal?.getAttribute("data-open")).toBe("true");
  });

  it("图片 chip 可点击并触发预览", async () => {
    render(<AttachmentChips attachments={mockAttachments} />);
    await screen.findByAltText("截图.png");
    const imgChip = screen.getByAltText("截图.png").closest("button");
    expect(imgChip).toBeInTheDocument();
    act(() => {
      imgChip?.click();
    });
    const modal = document.querySelector("[data-testid='file-preview-modal']");
    expect(modal?.getAttribute("data-open")).toBe("true");
  });

  it("空附件列表不渲染", () => {
    const { container } = render(<AttachmentChips attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
