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

  // 2026-11-02-scan-docs-unbound-view：degraded 变体（服务端有存量数据的页面，
  // 横幅非阻断、文案如实说明「当前展示工作区已有数据」，不得沿用 blocked 的
  // 「需要读取本机守护进程上的项目文件」阻断口径）。
  it("缺省 variant=blocked：data-variant 钉住阻断口径文案", () => {
    render(
      <DaemonRequiredNotice
        feature="运行时"
        workspaceId="ws-1"
        canBorrow={false}
      />,
    );
    expect(screen.getByTestId("daemon-required-notice").getAttribute("data-variant")).toBe("blocked");
    expect(screen.getByText(/此功能需要读取本机守护进程上的项目文件/)).toBeTruthy();
  });

  it("degraded 变体：已有数据口径文案 + 保留配置按钮", () => {
    render(
      <DaemonRequiredNotice
        feature="扫描文档"
        workspaceId="ws-1"
        canBorrow={false}
        variant="degraded"
      />,
    );
    expect(screen.getByTestId("daemon-required-notice").getAttribute("data-variant")).toBe("degraded");
    expect(screen.getByText(/当前展示的是工作区已有数据/)).toBeTruthy();
    expect(screen.queryByText(/此功能需要读取本机守护进程上的项目文件/)).toBeNull();
    expect(screen.getByTestId("daemon-required-config-btn")).toBeTruthy();
  });

  it("degraded 变体：配置入口与 onConfigured 回调复用同一状态机", () => {
    const onConfigured = vi.fn();
    render(
      <DaemonRequiredNotice
        feature="扫描文档"
        workspaceId="ws-1"
        canBorrow={false}
        variant="degraded"
        onConfigured={onConfigured}
      />,
    );
    fireEvent.click(screen.getByTestId("daemon-required-config-btn"));
    expect(screen.getByTestId("access-guide")).toBeTruthy();
    fireEvent.click(screen.getByTestId("access-configured"));
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("access-guide")).toBeNull();
  });
});
