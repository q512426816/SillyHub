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

  // ── 2026-10-13-change-files-view-polish：timeline.md 全屏转发时间线视图 ──
  describe("timeline.md 分发", () => {
    const timelineContent = [
      "# 合成时间线快照 — demo",
      "",
      "── 事件时间轴 ──",
      "05:39:32  🁢 变更诞生",
      "06:05:57  📝 tasks.md 内容变更",
      "",
      "墙钟：26min｜事件 2 条",
    ].join("\n");

    it("timeline.md 且结构命中 → TimelineView（与内联同源视图）", async () => {
      render(
        <MarkdownPreviewer
          blob={new Blob([timelineContent], { type: "text/markdown" })}
          url="blob:mock"
          meta={{ name: "timeline.md", mime: "text/markdown", size: 100 }}
        />,
      );
      await waitFor(() => {
        expect(document.querySelector('[data-testid="timeline-view"]')).not.toBeNull();
      });
      expect(screen.queryByTestId("markdown-text")).toBeNull();
    });

    it("timeline.md 但格式漂移（无事件时间轴区块）→ 回落 MarkdownText", async () => {
      render(
        <MarkdownPreviewer
          blob={new Blob(["# 普通文档\n\n正文"], { type: "text/markdown" })}
          url="blob:mock"
          meta={{ name: "timeline.md", mime: "text/markdown", size: 100 }}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId("markdown-text")).toBeInTheDocument();
      });
      expect(document.querySelector('[data-testid="timeline-view"]')).toBeNull();
    });
  });
});
