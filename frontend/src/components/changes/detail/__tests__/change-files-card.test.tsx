import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { ChangeFilesCard } from "@/components/changes/detail/change-files-card";

// 黑盒复用 ChangeFileTree：mock 掉，只验入口卡 + Dialog 打开行为
vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: ({ workspaceId, changeId }: { workspaceId: string; changeId: string }) => (
    <div data-testid="file-tree" data-workspace={workspaceId} data-change={changeId} />
  ),
}));

describe("ChangeFilesCard", () => {
  it("渲染入口卡（标题 + 打开按钮），Dialog 未开时文件树不在 DOM（惰性 mount）", () => {
    render(<ChangeFilesCard workspaceId="ws-1" changeId="ch-2" />);
    expect(screen.getByText("变更文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
    // Dialog 未开：文件树不在 DOM
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
  });

  it("点「打开」开弹窗，渲染 ChangeFileTree 并透传 workspaceId/changeId", () => {
    render(<ChangeFilesCard workspaceId="ws-1" changeId="ch-2" />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const tree = screen.getByTestId("file-tree");
    expect(tree).toHaveAttribute("data-workspace", "ws-1");
    expect(tree).toHaveAttribute("data-change", "ch-2");
  });
});
