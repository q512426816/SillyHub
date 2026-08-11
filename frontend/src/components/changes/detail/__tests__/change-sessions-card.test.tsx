import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { ChangeSessionsCard } from "@/components/changes/detail/change-sessions-card";

// 黑盒复用 ChangeSessionSection：mock 掉，只验包裹与传参
vi.mock("@/components/changes/change-session-section", () => ({
  ChangeSessionSection: ({ workspaceId, changeId }: { workspaceId: string; changeId: string }) => (
    <div data-testid="session-section" data-workspace={workspaceId} data-change={changeId} />
  ),
}));

describe("ChangeSessionsCard", () => {
  it("渲染标题且默认收起（点击后展开见 session section）", () => {
    render(<ChangeSessionsCard workspaceId="ws-1" changeId="ch-2" />);
    expect(screen.getByText("会话调试")).toBeInTheDocument();
    // 默认收起：session section 不可见
    expect(screen.queryByTestId("session-section")).not.toBeInTheDocument();
  });

  it("展开后透传 workspaceId/changeId 给 ChangeSessionSection", () => {
    render(<ChangeSessionsCard workspaceId="ws-1" changeId="ch-2" />);
    fireEvent(screen.getByRole("button"), new MouseEvent("click", { bubbles: true }));
    const sec = screen.getByTestId("session-section");
    expect(sec).toHaveAttribute("data-workspace", "ws-1");
    expect(sec).toHaveAttribute("data-change", "ch-2");
  });
});
