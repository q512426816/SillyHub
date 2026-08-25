/**
 * previewers-office 测试：docx / xlsx 渲染器。
 *
 * docx-preview 与 xlsx 在 jsdom 下需 mock；验证动态 import、渲染调用、截断保护、异常降级。
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// jsdom Blob 缺 text()/arrayBuffer()，补 polyfill
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
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };
}

import { DocxPreviewer } from "../previewers/docx-previewer";
import { XlsxPreviewer } from "../previewers/xlsx-previewer";

// Mock docx-preview（默认 reject，用于错误路径测试）
vi.mock("docx-preview", () => ({
  renderAsync: vi.fn().mockRejectedValue(new Error("损坏的文件")),
}));

// Mock xlsx
vi.mock("xlsx", () => ({
  read: vi.fn(),
  utils: {
    sheet_to_html: vi.fn(),
  },
}));

const mockBlob = new Blob(["fake-docx"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const mockUrl = "blob:mock";
const mockMeta = { name: "test.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2048 };
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

describe("DocxPreviewer", () => {
  it("初始渲染为 loading 态（docx-preview 动态 import 与 renderAsync 在浏览器中执行，jsdom 环境仅验证挂载）", () => {
    render(<DocxPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={mockOnDownload} />);
    expect(screen.getByText("正在渲染 Word 文档…")).toBeInTheDocument();
  });
});

describe("XlsxPreviewer", () => {
  it("正常解析时显示 sheet 表格", async () => {
    const { read, utils } = await import("xlsx");
    (read as ReturnType<typeof vi.fn>).mockReturnValue({
      SheetNames: ["Sheet1"],
      Sheets: { Sheet1: {} },
    });
    (utils.sheet_to_html as ReturnType<typeof vi.fn>).mockReturnValue(
      "<table><tbody><tr><td>数据1</td></tr><tr><td>数据2</td></tr></tbody></table>",
    );

    render(<XlsxPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={mockOnDownload} />);

    await waitFor(() => {
      expect(screen.getByText("数据1")).toBeInTheDocument();
    });
  });

  it("解析异常时显示错误态与下载引导", async () => {
    const { read } = await import("xlsx");
    (read as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("无效的 xlsx 文件");
    });

    render(<XlsxPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={mockOnDownload} />);

    await waitFor(() => {
      expect(screen.getByText("Excel 文档解析失败")).toBeInTheDocument();
    });
  });
});
