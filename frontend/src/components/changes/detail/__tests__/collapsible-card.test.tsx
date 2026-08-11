import { render, screen, fireEvent } from "@testing-library/react";

import { CollapsibleCard } from "@/components/changes/detail/collapsible-card";

describe("CollapsibleCard", () => {
  it("默认收起，children 不渲染", () => {
    render(
      <CollapsibleCard title="变更文件">
        <div data-testid="body">内容</div>
      </CollapsibleCard>,
    );
    expect(screen.getByText("变更文件")).toBeInTheDocument();
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("defaultOpen=true 初始展开，children 渲染", () => {
    render(
      <CollapsibleCard title="会话调试" defaultOpen={true}>
        <div data-testid="body">内容</div>
      </CollapsibleCard>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("点击 header 切换展开/收起", () => {
    render(
      <CollapsibleCard title="卡">
        <div data-testid="body">内容</div>
      </CollapsibleCard>,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
