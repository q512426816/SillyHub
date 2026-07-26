/**
 * task-13 / FR-06 live wiring：BorrowedSolutionFilesPanel 测试。
 *
 * 契约：
 *  - 挂载 → 调 listFiles({owner_type:"workspace", owner_id:workspaceId})
 *  - loading → 渲染 loading testid
 *  - 成功 → 透传 file_ids 给 BorrowedSolutionFiles（mock BorrowedSolutionFiles 断言 fileIds）
 *  - 失败 → 渲染 error testid
 *  - refreshKey 变化 → 重拉
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BorrowedSolutionFilesPanel } from "@/components/agent/borrowed-solution-files-panel";

// BorrowedSolutionFiles mock：断言透传 fileIds（隔离 FileViewer）
const { borrowedMock } = vi.hoisted(() => ({
  borrowedMock: { lastFileIds: [] as string[], calls: 0 },
}));
vi.mock("@/components/agent/borrowed-solution-files", () => ({
  BorrowedSolutionFiles: ({ fileIds }: { fileIds?: string[] }) => {
    borrowedMock.calls += 1;
    borrowedMock.lastFileIds = fileIds ?? [];
    return <div data-testid="borrowed-mock">{(fileIds ?? []).join(",")}</div>;
  },
}));

// listFiles mock：hoisted vi.fn，测试内 mockResolvedValue/RejectedValue 控制返回
const { listFilesMock } = vi.hoisted(() => ({ listFilesMock: vi.fn() }));
vi.mock("@/lib/file/api", () => ({
  listFiles: listFilesMock,
}));

describe("BorrowedSolutionFilesPanel（task-13 / FR-06 live wiring）", () => {
  beforeEach(() => {
    borrowedMock.calls = 0;
    borrowedMock.lastFileIds = [];
    listFilesMock.mockReset();
    listFilesMock.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
  });

  it("挂载即调 listFiles(owner_type=workspace, owner_id=workspaceId)", async () => {
    listFilesMock.mockResolvedValue([{ id: "f-1" }, { id: "f-2" }]);

    render(<BorrowedSolutionFilesPanel workspaceId="ws-99" />);

    await waitFor(() => {
      expect(borrowedMock.lastFileIds).toEqual(["f-1", "f-2"]);
    });
    expect(listFilesMock).toHaveBeenCalledWith({
      owner_type: "workspace",
      owner_id: "ws-99",
    });
  });

  it("成功 → 透传 file_ids 给 BorrowedSolutionFiles", async () => {
    listFilesMock.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);

    render(<BorrowedSolutionFilesPanel workspaceId="ws-1" title="我的方案" />);

    await waitFor(() => {
      expect(screen.getByTestId("borrowed-mock")).toHaveTextContent("a,b,c");
    });
  });

  it("loading 期间 → 渲染 loading testid（不渲染 BorrowedSolutionFiles）", () => {
    // never resolves → 停在 loading
    listFilesMock.mockReturnValue(new Promise(() => {}));

    render(<BorrowedSolutionFilesPanel workspaceId="ws-2" />);
    expect(screen.getByTestId("borrowed-solution-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("borrowed-mock")).not.toBeInTheDocument();
  });

  it("listFiles 失败 → 渲染 error testid", async () => {
    listFilesMock.mockRejectedValue(new Error("boom"));

    render(<BorrowedSolutionFilesPanel workspaceId="ws-3" />);

    await waitFor(() => {
      expect(screen.getByTestId("borrowed-solution-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("borrowed-mock")).not.toBeInTheDocument();
  });

  it("refreshKey 变化 → 重新调 listFiles", async () => {
    listFilesMock.mockResolvedValue([{ id: "x" }]);

    const { rerender } = render(
      <BorrowedSolutionFilesPanel workspaceId="ws-4" refreshKey={0} />,
    );
    await waitFor(() => expect(listFilesMock).toHaveBeenCalledTimes(1));

    rerender(<BorrowedSolutionFilesPanel workspaceId="ws-4" refreshKey={1} />);
    await waitFor(() => expect(listFilesMock).toHaveBeenCalledTimes(2));
  });
});
