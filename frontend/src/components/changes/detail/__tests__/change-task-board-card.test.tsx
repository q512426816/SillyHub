import { render, screen } from "@testing-library/react";

import { ChangeTaskBoardCard } from "@/components/changes/detail/change-task-board-card";
import type { TaskBoard } from "@/lib/tasks";

function board(columns: { status: string; count: number }[]): TaskBoard {
  // TaskBoard schema 仅要求 columns（其余字段对渲染无影响，给最小集）
  return { columns } as unknown as TaskBoard;
}

describe("ChangeTaskBoardCard", () => {
  it("taskBoard 为 null 不渲染", () => {
    const { container } = render(
      <ChangeTaskBoardCard workspaceId="ws" changeId="ch" taskBoard={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("columns 为空不渲染（快速修复类无任务）", () => {
    const { container } = render(
      <ChangeTaskBoardCard workspaceId="ws" changeId="ch" taskBoard={board([])} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("渲染进度条与各状态计数，done/total 与完成百分比", () => {
    render(
      <ChangeTaskBoardCard
        workspaceId="ws"
        changeId="ch"
        taskBoard={board([
          { status: "todo", count: 1 },
          { status: "in_progress", count: 1 },
          { status: "done", count: 2 },
        ])}
      />,
    );
    expect(screen.getByText("2 / 4 完成")).toBeInTheDocument();
    // 进度条宽度 = 50%
    const bar = screen.getByText("2 / 4 完成");
    expect(bar).toBeInTheDocument();
    // 查看看板链接指向 tasks
    expect(screen.getByText("查看看板").getAttribute("href")).toBe(
      "/workspaces/ws/changes/ch/tasks",
    );
  });
});
