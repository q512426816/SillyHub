import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ChangeFilesCard } from "@/components/changes/detail/change-files-card";

// 黑盒复用 ChangeFileTree：mock 掉，只验 ChangeFilesCard 包裹与传参
vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: ({ workspaceId, changeId }: { workspaceId: string; changeId: string }) => (
    <div data-testid="file-tree" data-workspace={workspaceId} data-change={changeId} />
  ),
}));

describe("ChangeFilesCard", () => {
  it("渲染标题且默认展开，透传 workspaceId/changeId 给 ChangeFileTree", () => {
    render(<ChangeFilesCard workspaceId="ws-1" changeId="ch-2" />);
    expect(screen.getByText("变更文件")).toBeInTheDocument();
    // defaultOpen=true → body 渲染
    const tree = screen.getByTestId("file-tree");
    expect(tree).toHaveAttribute("data-workspace", "ws-1");
    expect(tree).toHaveAttribute("data-change", "ch-2");
  });
});
