import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DaemonRequiredNotice } from "@/components/daemon-required-notice";

// mock WorkspaceAccessGuide：避免其内部 daemon 实例列表请求，聚焦本组件行为。
vi.mock("@/components/workspace-access-guide", () => ({
  WorkspaceAccessGuide: ({ onConfigured }: { onConfigured: () => void }) => (
    <div data-testid="access-guide">
      <button data-testid="access-configured" onClick={onConfigured}>
        done
      </button>
    </div>
  ),
}));

afterEach(() => cleanup());

describe("DaemonRequiredNotice", () => {
  it("渲染 feature 标题 + 说明 + 配置按钮", () => {
    render(
      <DaemonRequiredNotice
        feature="运行时"
        workspaceId="ws-1"
        canBorrow={false}
      />,
    );
    expect(screen.getByTestId("daemon-required-notice")).toBeTruthy();
    expect(screen.getByText(/运行时需要守护进程/)).toBeTruthy();
    expect(screen.getByTestId("daemon-required-config-btn")).toBeTruthy();
  });

  it("canBorrow=true 显示借用提示", () => {
    render(
      <DaemonRequiredNotice
        feature="扫描文档"
        workspaceId="ws-1"
        canBorrow={true}
      />,
    );
    expect(screen.queryByTestId("daemon-required-borrow-hint")).toBeTruthy();
  });

  it("canBorrow=false 不显示借用提示", () => {
    render(
      <DaemonRequiredNotice
        feature="扫描文档"
        workspaceId="ws-1"
        canBorrow={false}
      />,
    );
    expect(screen.queryByTestId("daemon-required-borrow-hint")).toBeNull();
  });

  it("点配置按钮展开 AccessGuide；配置成功回调 onConfigured 并收起", () => {
    const onConfigured = vi.fn();
    render(
      <DaemonRequiredNotice
        feature="组件拓扑"
        workspaceId="ws-1"
        canBorrow={false}
        onConfigured={onConfigured}
      />,
    );
    // 初始不渲染 AccessGuide
    expect(screen.queryByTestId("access-guide")).toBeNull();
    // 点击配置 → 内联展开
    fireEvent.click(screen.getByTestId("daemon-required-config-btn"));
    expect(screen.getByTestId("access-guide")).toBeTruthy();
    // AccessGuide 报告配置成功 → 回调 onConfigured 并收起
    fireEvent.click(screen.getByTestId("access-configured"));
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("access-guide")).toBeNull();
  });
});
