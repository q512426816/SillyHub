/**
 * markdown-previewer 测试：md 经 MarkdownText 渲染（D-006@v1 XSS 防线）。
 *
 * 验证未直接 import @uiw/react-markdown-preview，且内容经 MarkdownText 处理。
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// jsdom Blob 缺 text()，补 polyfill
if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

import { MarkdownPreviewer } from "../previewers/markdown-previewer";

// Mock MarkdownText（避免 jsdom 下 rehype 渲染慢）
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text" data-content={content} />
  ),
}));

const mockBlob = new Blob(["# 标题\n\n正文内容"], { type: "text/markdown" });
const mockMeta = { name: "notes.md", mime: "text/markdown", size: 512 };
const mockOnDownload = vi.fn();

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarkdownPreviewer", () => {
  it("读取 blob 内容后经 MarkdownText 渲染", async () => {
    render(<MarkdownPreviewer blob={mockBlob} url="blob:mock" meta={mockMeta} onDownload={mockOnDownload} />);

    await waitFor(() => {
      const el = screen.getByTestId("markdown-text");
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("data-content", "# 标题\n\n正文内容");
    });
  });

  it("读取失败时显示错误态与下载引导", async () => {
    const badBlob = {
      text: () => Promise.reject(new Error("读取失败")),
    } as Blob;

    render(<MarkdownPreviewer blob={badBlob} url="blob:mock" meta={mockMeta} onDownload={mockOnDownload} />);

    await waitFor(() => {
      expect(screen.getByText("Markdown 读取失败")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /下载文件/ })).toBeInTheDocument();
    });
  });
});
