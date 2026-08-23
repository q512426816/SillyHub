// task-08（2026-08-23-agent-file-upload-mcp / FR-01 / D-001@v1）：FileMessageCard 单测。
//
// 覆盖：
//   1. 图片 mime → 缩略图形态：FileImage preview 接线（JWT blob 路径 + 可点击放大）
//      + 名称 / 大小 + 下载链接；
//   2. 非图片 mime → 通用形态：FileTypeIcon + 名称 / 描述 + formatFileSize + 下载按钮；
//   3. 下载交互：两形态点击均触发 downloadFile(fileId, name)；
//   4. ts 展示：非空时大小后追加 Date.toLocaleString("zh-CN")，缺省只显示大小；
//      description 空串不渲染描述行。
//
// 边界：mock @/lib/file/api（downloadFile / fetchFileBlob）与 @/components/file-image
// （jsdom 下 antd Image 卡 loading 不渲染 img，同 file-viewer.test.tsx 处理）；本文件
// 只锁卡片两形态分流与下载接线，FileImage 自身 blob 生命周期不在此重复覆盖。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/file/api", () => ({
  downloadFile: vi.fn(() => Promise.resolve()),
  fetchFileBlob: vi.fn(() => Promise.resolve(new Blob(["x"], { type: "image/png" }))),
}));
vi.mock("@/components/file-image", () => ({
  FileImage: (props: { id: string; alt?: string; preview?: boolean; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- 桩组件透传 img（jsdom 下 antd Image 卡 loading，同 file-viewer.test 处理）
    <img
      alt={props.alt}
      data-file-id={props.id}
      data-preview={props.preview ? "1" : "0"}
      className={props.className}
    />
  ),
}));

import { FileMessageCard } from "@/components/daemon/file-message-card";
import { downloadFile } from "@/lib/file/api";

const downloadMock = vi.mocked(downloadFile);

const IMG_PROPS = {
  fileId: "f-1",
  name: "q3-bug-trend.png",
  size: 186368, // 186368 / 1024 = 182.0
  mime: "image/png",
  description: "三季度 Bug 趋势图",
} as const;

const CSV_PROPS = {
  fileId: "f-2",
  name: "q3-bug-data.csv",
  size: 47104, // 47104 / 1024 = 46.0
  mime: "text/csv",
  description: "三季度 Bug 明细数据",
} as const;

describe("FileMessageCard", () => {
  it("图片 mime → 缩略图卡片：FileImage preview 接线（可点击放大）+ 名称/大小 + 下载触发 downloadFile(fileId, name)", () => {
    render(<FileMessageCard {...IMG_PROPS} />);
    const img = document.querySelector('img[data-file-id="f-1"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute("data-preview")).toBe("1"); // preview 模式（点击放大）
    expect(img?.getAttribute("alt")).toBe("q3-bug-trend.png");
    // 名称 + 大小（formatFileSize）落在缩略图 caption 行
    expect(screen.getByTitle("q3-bug-trend.png")).toBeInTheDocument();
    expect(screen.getByText(/182\.0 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载 q3-bug-trend.png" }));
    expect(downloadMock).toHaveBeenCalledWith("f-1", "q3-bug-trend.png");
  });

  it("非图片 mime → 通用卡片：FileTypeIcon + 名称/描述/大小 + 下载按钮触发 downloadFile", () => {
    render(<FileMessageCard {...CSV_PROPS} />);
    // 缩略图形态未启用（无 img 标签；FileTypeIcon 的 antd 图标是 span[role=img] 不算）
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("q3-bug-data.csv")).toBeInTheDocument();
    expect(screen.getByText("三季度 Bug 明细数据")).toBeInTheDocument();
    expect(screen.getByText("46.0 KB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载 q3-bug-data.csv" }));
    expect(downloadMock).toHaveBeenCalledWith("f-2", "q3-bug-data.csv");
  });

  it("ts 非空 → 大小后追加 zh-CN 本地时间（Date.toLocaleString 显式传 zh-CN）；ts 缺省只显示大小", () => {
    const ts = 1_756_000_000_000;
    const { rerender } = render(<FileMessageCard {...CSV_PROPS} ts={ts} />);
    expect(screen.getByText(`46.0 KB · ${new Date(ts).toLocaleString("zh-CN")}`)).toBeInTheDocument();
    rerender(<FileMessageCard {...CSV_PROPS} />);
    expect(screen.getByText("46.0 KB")).toBeInTheDocument();
  });

  it("description 空串 → 通用卡片不渲染描述行（空值不占位）", () => {
    render(<FileMessageCard {...CSV_PROPS} description="" />);
    expect(screen.getByText("q3-bug-data.csv")).toBeInTheDocument();
    expect(screen.queryByText("三季度 Bug 明细数据")).toBeNull();
  });
});
