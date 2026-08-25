/**
 * previewers-basic 冒烟测试：image / pdf / fallback 三渲染器。
 *
 * jsdom 无 createObjectURL，需 mock；antd Image 在 jsdom 下部分功能受限，仅测渲染结构。
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  ImagePreviewer,
  PdfPreviewer,
  FallbackPreviewer,
} from "../previewers";

const mockBlob = new Blob(["test"], { type: "image/png" });
const mockUrl = "blob:mock";
const mockMeta = { name: "test.png", mime: "image/png", size: 1024 };

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => mockUrl),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImagePreviewer", () => {
  it("渲染 antd Image 且 alt 为文件名", () => {
    render(<ImagePreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});

describe("PdfPreviewer", () => {
  it("渲染 iframe 且 src 为 objectURL", () => {
    render(<PdfPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />);
    const iframe = document.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.src).toBe(mockUrl);
  });
});

describe("FallbackPreviewer", () => {
  it("显示不支持在线预览说明与下载按钮", () => {
    const onDownload = vi.fn();
    render(
      <FallbackPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={onDownload} />,
    );
    expect(screen.getByText("该格式暂不支持在线预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载文件/ })).toBeInTheDocument();
  });

  it("点击下载按钮触发 onDownload", () => {
    const onDownload = vi.fn();
    render(
      <FallbackPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={onDownload} />,
    );
    screen.getByRole("button", { name: /下载文件/ }).click();
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("显示文件大小", () => {
    render(<FallbackPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });
});
