/**
 * task-06：WorkspaceBindingDialog 组件测试。
 *
 * 覆盖 CB-2（容器化 AccessGuide，不重写表单）+ 回调桥接契约：
 * - open=true 渲染 AccessGuide（首次模式，传 workspaceId，不传 initial）
 * - open=false 不渲染内容（Radix Dialog 受控）
 * - AccessGuide onConfigured → fetchMyBinding 回读 → onBound(binding) → onClose()
 * - 回读失败退化为 onBound(null) 但仍 onClose（不卡住用户）
 *
 * 参照 workspace-config-card.test.tsx 的 vi.mock("@/components/workspace-access-guide")
 * 模式，隔离其内部 daemon 列表加载链。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceBindingDialog } from "@/components/workspace-binding-dialog";
import type { MemberBindingView } from "@/lib/workspace-binding";

// ── WorkspaceAccessGuide mock（CB-2：避免其内部 daemon 列表加载链）──────────────
// 暴露最近一次 props（workspaceId/onConfigured/initial）以断言「首次模式不传 initial」。
const accessGuideMock = vi.hoisted(() => ({
  lastProps: null as null | {
    workspaceId: string;
    onConfigured: () => void;
    initial?: unknown;
  },
}));
vi.mock("@/components/workspace-access-guide", () => ({
  WorkspaceAccessGuide: (props: {
    workspaceId: string;
    onConfigured: () => void;
    initial?: unknown;
  }) => {
    accessGuideMock.lastProps = props;
    return (
      <div data-testid="workspace-access-guide">
        <span data-testid="access-guide-initial">
          {props.initial === undefined ? "undefined" : JSON.stringify(props.initial)}
        </span>
        <button
          data-testid="access-guide-configured"
          onClick={() => props.onConfigured()}
        >
          模拟保存
        </button>
      </div>
    );
  },
}));

// ── lib mock（fetchMyBinding 回读链）──────────────────────────────────────────
const bindingApi = vi.hoisted(() => ({
  fetchMyBinding: vi.fn(),
}));
vi.mock("@/lib/workspace-binding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-binding")>(
    "@/lib/workspace-binding",
  );
  return { ...actual, fetchMyBinding: bindingApi.fetchMyBinding };
});

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeBinding(
  overrides: Partial<MemberBindingView> = {},
): MemberBindingView {
  return {
    workspace_id: "ws-1",
    user_id: "user-1",
    daemon_id: "daemon-1",
    runtime_id: "rid-1",
    root_path: "C:/proj/multi-agent-platform",
    path_source: "daemon-client",
    synced_at: "2026-07-01T01:00:00Z",
    last_scan_at: null,
    init_synced_at: null,
    init_synced_spec_version: null,
    ...overrides,
  } as unknown as MemberBindingView;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WorkspaceBindingDialog（task-06 / CB-2 容器化）", () => {
  afterEach(() => {
    cleanup();
    accessGuideMock.lastProps = null;
    bindingApi.fetchMyBinding.mockReset();
  });

  it("open=true：渲染 AccessGuide（首次模式，传 workspaceId，不传 initial）", () => {
    bindingApi.fetchMyBinding.mockResolvedValue(makeBinding());
    render(
      <WorkspaceBindingDialog
        workspaceId="ws-1"
        open={true}
        onBound={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // AccessGuide 渲染
    expect(screen.getByTestId("workspace-access-guide")).toBeInTheDocument();
    // 传 workspaceId
    expect(accessGuideMock.lastProps?.workspaceId).toBe("ws-1");
    // 首次绑定模式：不传 initial（CB-2）
    expect(accessGuideMock.lastProps?.initial).toBeUndefined();
    expect(screen.getByTestId("access-guide-initial")).toHaveTextContent("undefined");
    // Radix 无障碍：标题/描述齐备
    expect(
      screen.getByText("配置此工作空间的守护进程"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("绑定你的守护进程和本地路径后才能进入工作区。"),
    ).toBeInTheDocument();
  });

  it("open=false：不渲染 AccessGuide（Radix Dialog 受控）", () => {
    bindingApi.fetchMyBinding.mockResolvedValue(makeBinding());
    render(
      <WorkspaceBindingDialog
        workspaceId="ws-1"
        open={false}
        onBound={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Radix Dialog open=false 时不挂载内容
    expect(screen.queryByTestId("workspace-access-guide")).not.toBeInTheDocument();
    expect(
      screen.queryByText("配置此工作空间的守护进程"),
    ).not.toBeInTheDocument();
  });

  it("AccessGuide onConfigured → fetchMyBinding 回读 → onBound(binding) → onClose", async () => {
    const onBound = vi.fn();
    const onClose = vi.fn();
    const binding = makeBinding({
      daemon_id: "daemon-9",
      root_path: "C:/proj/foo",
    });
    bindingApi.fetchMyBinding.mockResolvedValue(binding);

    render(
      <WorkspaceBindingDialog
        workspaceId="ws-1"
        open={true}
        onBound={onBound}
        onClose={onClose}
      />,
    );

    // 触发 AccessGuide 保存
    fireEvent.click(screen.getByTestId("access-guide-configured"));

    // 回读 → onBound(binding) → onClose
    await waitFor(() => {
      expect(onBound).toHaveBeenCalledTimes(1);
    });
    expect(bindingApi.fetchMyBinding).toHaveBeenCalledWith("ws-1");
    expect(onBound).toHaveBeenCalledWith(binding);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("回读失败退化为 onBound(null)，但仍 onClose（不卡住用户）", async () => {
    const onBound = vi.fn();
    const onClose = vi.fn();
    // fetchMyBinding 内部已 try/catch 返 null，但此处直接测回读返回 null 的兜底路径
    bindingApi.fetchMyBinding.mockResolvedValue(null);

    render(
      <WorkspaceBindingDialog
        workspaceId="ws-1"
        open={true}
        onBound={onBound}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("access-guide-configured"));

    await waitFor(() => {
      expect(onBound).toHaveBeenCalledTimes(1);
    });
    expect(onBound).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
