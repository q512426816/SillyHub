/**
 * change 2026-07-25-daemon-borrow-for-business task-13 / FR-06 / D-001 / D-009
 *
 * BorrowedSolutionFiles 组件测试。
 *
 * 契约：
 *  - fileIds 为空（或 undefined）→ 渲染空态文案 + data-testid=borrowed-solution-empty
 *  - fileIds 非空 → 渲染 FileViewer（mock），传入相同 fileIds
 *  - 复用 FileViewer，不重写预览/下载（D-009）
 *
 * FileViewer 内部走 fetchFileMetaBatch + antd Image，jsdom 下需 mock，参考
 * file-viewer.test.tsx 模式。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BorrowedSolutionFiles } from "@/components/agent/borrowed-solution-files";

// FileViewer mock：隔离 antd Image + fetchFileMetaBatch，断言传入 fileIds
const fileViewerMock = vi.hoisted(() => ({ lastFileIds: null as string[] | null }));
vi.mock("@/components/file-viewer", () => ({
  FileViewer: ({ fileIds }: { fileIds?: string[] }) => {
    fileViewerMock.lastFileIds = fileIds ?? [];
    return (
      <div data-testid="file-viewer-mock">{(fileIds ?? []).join(",")}</div>
    );
  },
}));

describe("BorrowedSolutionFiles（task-13 / FR-06）", () => {
  afterEach(() => {
    cleanup();
    fileViewerMock.lastFileIds = null;
  });

  it("fileIds 为空 → 渲染空态文案 + empty testid（不渲染 FileViewer）", () => {
    render(<BorrowedSolutionFiles fileIds={[]} />);
    expect(screen.getByTestId("borrowed-solution-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/暂无借用方案/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("file-viewer-mock")).not.toBeInTheDocument();
  });

  it("fileIds 缺省 → 同样渲染空态（防御 undefined）", () => {
    render(<BorrowedSolutionFiles />);
    expect(screen.getByTestId("borrowed-solution-empty")).toBeInTheDocument();
  });

  it("fileIds 非空 → 渲染 FileViewer 并透传 fileIds（复用预览/下载，D-009）", () => {
    render(
      <BorrowedSolutionFiles fileIds={["file-1", "file-2"]} title="我的方案" />,
    );
    // 标题可覆盖
    expect(screen.getByText("我的方案")).toBeInTheDocument();
    // FileViewer 渲染且收到正确 fileIds
    expect(screen.getByTestId("file-viewer-mock")).toBeInTheDocument();
    expect(fileViewerMock.lastFileIds).toEqual(["file-1", "file-2"]);
  });

  it("自定义空态文案生效", () => {
    render(
      <BorrowedSolutionFiles fileIds={[]} emptyText="还没有方案哦" />,
    );
    expect(screen.getByText("还没有方案哦")).toBeInTheDocument();
  });
});
