import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { ChangeSessionsCard } from "@/components/changes/detail/change-sessions-card";

// 黑盒复用 ChangeSessionSection：mock 掉，只验入口卡 + Dialog 打开行为
vi.mock("@/components/changes/change-session-section", () => ({
  ChangeSessionSection: ({ workspaceId, changeId }: { workspaceId: string; changeId: string }) => (
    <div data-testid="session-section" data-workspace={workspaceId} data-change={changeId} />
  ),
}));

describe("ChangeSessionsCard", () => {
  it("渲染入口卡（标题 + 打开按钮），Dialog 未开时会话面板不在 DOM（惰性 mount）", () => {
    render(<ChangeSessionsCard workspaceId="ws-1" changeId="ch-2" />);
    expect(screen.getByText("会话调试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
    expect(screen.queryByTestId("session-section")).not.toBeInTheDocument();
  });

  it("点「打开」开弹窗，渲染 ChangeSessionSection 并透传 workspaceId/changeId", () => {
    render(<ChangeSessionsCard workspaceId="ws-1" changeId="ch-2" />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const sec = screen.getByTestId("session-section");
    expect(sec).toHaveAttribute("data-workspace", "ws-1");
    expect(sec).toHaveAttribute("data-change", "ch-2");
  });
});
