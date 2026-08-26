/**
 * task-04 · MobileWorkspaceHeader 单测（design §7 props 契约 / FR-02 / D-004@V1）。
 *
 * 覆盖验收面：
 *  - props 契约：workspace/tab/onTabChange/onBack（工作区名 + 副标题渲染，
 *    display_alias 优先于 name）；
 *  - 段控双 Tab：role=tablist/tab + aria-selected 高亮随 props.tab（受控）；
 *  - 点击非当前 tab → onTabChange 恰一次（带目标 key）；点击当前 tab 不触发；
 *  - 返回按钮：点击 → onBack 恰一次；触摸热区 ≥44px（min-h/min-w-[44px]）；
 *  - Tab 热区 ≥44px；选中态 brand 语义阶类（bg-brand-600）。
 *
 * 组件纯回调（无路由/数据请求），无需 mock next/navigation 与 @/lib 数据层。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MobileWorkspaceHeader,
  type WorkspaceTabKey,
} from "@/components/mobile/mobile-workspace-header";
import type { Workspace } from "@/lib/workspaces";

/** 完整 WorkspaceRead fixture（api-types 生成类型，必填字段齐全）。 */
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "multi-agent-platform",
    display_alias: null,
    slug: "map-42",
    root_path: "C:/repo/multi-agent-platform",
    status: "active",
    component_key: null,
    type: null,
    role: null,
    description: null,
    repo_url: null,
    default_branch: null,
    default_agent: null,
    default_model: null,
    tech_stack: [],
    build_command: null,
    test_command: null,
    source_yaml_path: null,
    created_by: null,
    created_at: "2026-08-26T00:00:00Z",
    updated_at: "2026-08-26T00:00:00Z",
    last_scanned_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function renderHeader(props: {
  workspace?: Workspace;
  tab?: WorkspaceTabKey;
  onTabChange?: (t: WorkspaceTabKey) => void;
  onBack?: () => void;
} = {}) {
  return render(
    <MobileWorkspaceHeader
      workspace={props.workspace ?? makeWorkspace()}
      tab={props.tab ?? "changes"}
      onTabChange={props.onTabChange ?? vi.fn()}
      onBack={props.onBack ?? vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("MobileWorkspaceHeader 渲染契约", () => {
  it("渲染工作区名与副标题（slug）", () => {
    renderHeader();
    expect(screen.getByText("multi-agent-platform")).toBeInTheDocument();
    expect(screen.getByText("map-42")).toBeInTheDocument();
  });

  it("display_alias 存在时优先作主标题，name 降为不可见", () => {
    renderHeader({
      workspace: makeWorkspace({
        name: "multi-agent-platform",
        display_alias: "多代理平台",
        slug: "map-slug",
      }),
    });
    expect(screen.getByText("多代理平台")).toBeInTheDocument();
    expect(screen.queryByText("multi-agent-platform")).not.toBeInTheDocument();
    expect(screen.getByText("map-slug")).toBeInTheDocument();
  });
});

describe("MobileWorkspaceHeader 段控双 Tab", () => {
  it("tablist/tab + aria-selected：当前 tab 高亮、另一个不高亮", () => {
    renderHeader({ tab: "changes" });
    expect(
      screen.getByTestId("mobile-workspace-header-tabs"),
    ).toHaveAttribute("role", "tablist");

    const changesTab = screen.getByTestId("mobile-workspace-header-tab-changes");
    const sessionsTab = screen.getByTestId("mobile-workspace-header-tab-sessions");
    expect(changesTab).toHaveAttribute("role", "tab");
    expect(sessionsTab).toHaveAttribute("role", "tab");
    expect(changesTab).toHaveAttribute("aria-selected", "true");
    expect(sessionsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "变更中心" })).toBe(changesTab);
    expect(screen.getByRole("tab", { name: "会话" })).toBe(sessionsTab);
  });

  it("受控高亮：tab 切到 sessions 后 aria-selected 反转", () => {
    const { rerender } = renderHeader({ tab: "changes" });
    rerender(
      <MobileWorkspaceHeader
        workspace={makeWorkspace()}
        tab="sessions"
        onTabChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("mobile-workspace-header-tab-changes"),
    ).toHaveAttribute("aria-selected", "false");
    expect(
      screen.getByTestId("mobile-workspace-header-tab-sessions"),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("点击非当前 tab → onTabChange 恰一次且带目标 key", () => {
    const onTabChange = vi.fn();
    renderHeader({ tab: "changes", onTabChange });
    fireEvent.click(screen.getByTestId("mobile-workspace-header-tab-sessions"));
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("sessions");
  });

  it("点击当前 tab → onTabChange 不触发", () => {
    const onTabChange = vi.fn();
    renderHeader({ tab: "changes", onTabChange });
    fireEvent.click(screen.getByTestId("mobile-workspace-header-tab-changes"));
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("选中态走 brand 语义阶类（bg-brand-600）", () => {
    renderHeader({ tab: "changes" });
    expect(
      screen.getByTestId("mobile-workspace-header-tab-changes"),
    ).toHaveClass("bg-brand-600");
    expect(
      screen.getByTestId("mobile-workspace-header-tab-sessions"),
    ).not.toHaveClass("bg-brand-600");
  });
});

describe("MobileWorkspaceHeader 返回", () => {
  it("点击返回 → onBack 恰一次", () => {
    const onBack = vi.fn();
    renderHeader({ onBack });
    fireEvent.click(screen.getByTestId("mobile-workspace-header-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("返回按钮触摸热区 ≥44px（min-h/min-w-[44px]）", () => {
    renderHeader();
    expect(screen.getByTestId("mobile-workspace-header-back")).toHaveClass(
      "min-h-[44px]",
      "min-w-[44px]",
    );
  });

  it("tab 按钮触摸热区 ≥44px（min-h-[44px]）", () => {
    renderHeader();
    expect(
      screen.getByTestId("mobile-workspace-header-tab-changes"),
    ).toHaveClass("min-h-[44px]");
    expect(
      screen.getByTestId("mobile-workspace-header-tab-sessions"),
    ).toHaveClass("min-h-[44px]");
  });
});
