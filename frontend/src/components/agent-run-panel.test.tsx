/**
 * AgentRunPanel 集成测试（task-04 / FR-04 / D-003@v1）。
 *
 * 覆盖范围：
 *   - FR-04 case1：非空 perms → AgentLogViewer 渲染 PermissionApprovalCard / AskUserDialogCard
 *     （原 bug：旧 Bootstrap SSE 客户端丢弃无 timestamp 的 permission_request 事件）
 *   - FR-04 case2：permission_resolved / 卡片决策后 perms 移除 → 卡片消失
 *   - D-003@v1：panel 把 AgentLogViewer.onPermissionResolved 接到 hook.dismissPerm
 *     （卡片自调 respondSessionPermission，panel 只做本地 perms 移除）
 *   - FR-03 顺带覆盖：title/emptyText/actions/isLive 透传到 viewer
 *
 * 测试策略：mock `useAgentRunStream` hook，注入可控的 perms/input/loading，
 * 渲染 <AgentRunPanel> 后断言卡片出现/消失。不真连 SSE（hook 单测负责）。
 *
 * 依据：
 *   - .sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/tasks/task-04.md
 *   - .sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/design.md §7.2 / §7.3
 *   - frontend/src/components/agent-run-panel.tsx（被测）
 *   - frontend/src/components/agent-log-viewer.tsx（hasPermissionCards 渲染分支）
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRunPanel } from "@/components/agent-run-panel";
import type { SessionPermissionRequest } from "@/lib/daemon";
import {
  useAgentRunStream,
  type AgentRunInputStream,
  type UseAgentRunStreamResult,
} from "@/lib/use-agent-run-stream";

// —— mock hook：每个用例通过 mockReturnValue 注入可控返回值 ——
vi.mock("@/lib/use-agent-run-stream", () => ({
  useAgentRunStream: vi.fn(),
  // 类型本身是 type-only，导出占位避免 runtime 缺失
}));

// —— mock session：卡片调 apiFetch → useSession.getState().accessToken ——
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

function makePermRequest(
  overrides: Partial<SessionPermissionRequest> = {},
): SessionPermissionRequest {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-abc123",
    tool_name: "Bash",
    input: { command: "ls -la" },
    ...overrides,
  };
}

function makeDialogRequest(
  overrides: Partial<SessionPermissionRequest> = {},
): SessionPermissionRequest {
  return {
    ...makePermRequest({ tool_name: "AskUserQuestion", request_id: "req-dialog-1" }),
    dialog_kind: "ask_user",
    dialog_payload: {
      questions: [
        {
          question: "使用哪个运行时目录？",
          header: "运行时目录",
          multiSelect: false,
          options: [
            { label: "项目本地", description: "项目内", preview: "/local" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function makeInput(): AgentRunInputStream {
  return {
    values: {},
    submitting: {},
    errors: {},
    replied: new Set<string>(),
    set: vi.fn(),
    submit: vi.fn(),
  };
}

function mockHook(
  overrides: Partial<UseAgentRunStreamResult> = {},
): UseAgentRunStreamResult {
  return {
    logs: [],
    status: "running",
    streaming: true,
    loading: false,
    error: null,
    perms: [],
    dismissPerm: vi.fn(),
    input: makeInput(),
    clear: vi.fn(),
    ...overrides,
  };
}

function mockHookFn(overrides: Partial<UseAgentRunStreamResult>): UseAgentRunStreamResult {
  const result = mockHook(overrides);
  vi.mocked(useAgentRunStream).mockReturnValue(result);
  return result;
}

const PANEL_PROPS = {
  workspaceId: "ws-1",
  runId: "run-1",
  isActive: true,
  title: "Agent run",
} as const;

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe("AgentRunPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useAgentRunStream).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("FR-04 baseline：perms 为空时不渲染任何审批卡片", () => {
    mockHookFn({ perms: [] });
    render(<AgentRunPanel {...PANEL_PROPS} />);

    expect(screen.queryByText("工具调用审批")).not.toBeInTheDocument();
    expect(screen.queryByText("ask_user")).not.toBeInTheDocument();
  });

  it("FR-04 case1：单条普通 permission_request → 渲染 PermissionApprovalCard", () => {
    mockHookFn({ perms: [makePermRequest()] });
    render(<AgentRunPanel {...PANEL_PROPS} />);

    // 标题 + tool_name badge + request_id 前 12 字符
    expect(screen.getByText("工具调用审批")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    // permission-approval-card.tsx:131 渲染 `{request_id.slice(0,12)}…`
    expect(screen.getByText("req-abc123…")).toBeInTheDocument();

    // data-request-id 存在（精准定位）
    const card = document.querySelector(
      '[data-request-id="req-abc123"]',
    );
    expect(card).not.toBeNull();

    // 只渲染 1 张审批卡片
    expect(screen.getAllByText("工具调用审批")).toHaveLength(1);
    // 不渲染 ask_user dialog
    expect(screen.queryByText("ask_user")).not.toBeInTheDocument();
  });

  it("FR-04 case1：单条 AskUserQuestion dialog → 渲染 AskUserDialogCard", () => {
    mockHookFn({ perms: [makeDialogRequest()] });
    render(<AgentRunPanel {...PANEL_PROPS} />);

    // 问题文本 + ask_user badge
    expect(screen.getByText("使用哪个运行时目录？")).toBeInTheDocument();
    expect(screen.getByText("ask_user")).toBeInTheDocument();
    // 不渲染普通审批卡片
    expect(screen.queryByText("工具调用审批")).not.toBeInTheDocument();
  });

  it("FR-04 多卡：普通 + dialog 混合 → 两类卡片都渲染（key 唯一）", () => {
    mockHookFn({
      perms: [makePermRequest(), makeDialogRequest()],
    });
    render(<AgentRunPanel {...PANEL_PROPS} />);

    expect(screen.getByText("工具调用审批")).toBeInTheDocument();
    expect(screen.getByText("使用哪个运行时目录？")).toBeInTheDocument();
    expect(screen.getByText("ask_user")).toBeInTheDocument();

    // 两张卡片各自的 data-request-id 都存在
    expect(
      document.querySelector('[data-request-id="req-abc123"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-request-id="req-dialog-1"]'),
    ).not.toBeNull();
  });

  it("FR-04 case2：perms 从有变无（permission_resolved）→ 卡片消失", () => {
    mockHookFn({ perms: [makePermRequest()] });
    const { rerender } = render(<AgentRunPanel {...PANEL_PROPS} />);

    // 第一次：卡片可见
    expect(screen.getByText("工具调用审批")).toBeInTheDocument();

    // 模拟 hook 收到 permission_resolved → perms 移除该卡片（重新 mock 返回值）
    mockHookFn({ perms: [] });
    rerender(<AgentRunPanel {...PANEL_PROPS} />);

    expect(screen.queryByText("工具调用审批")).not.toBeInTheDocument();
  });

  it("D-003：卡片决策成功 → panel 调 hook.dismissPerm(requestId)", async () => {
    // PermissionApprovalCard 自调 respondSessionPermission → apiFetch → fetch
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    const dismissPerm = vi.fn();
    mockHookFn({ perms: [makePermRequest()], dismissPerm });
    render(<AgentRunPanel {...PANEL_PROPS} />);

    // 点击「允许」按钮（permission-approval-card.tsx:180）
    fireEvent.click(screen.getByRole("button", { name: /允许/ }));

    // 卡片自调 API 成功后 → onResolved(request_id, "allow")
    // panel 的 handlePermissionResolved 转发给 dismissPerm(request_id)（忽略 decision）
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(dismissPerm).toHaveBeenCalledTimes(1);
      expect(dismissPerm).toHaveBeenCalledWith("req-abc123");
    });
  });

  it("viewer 加载语义：loading=true 时显示「加载日志中」且不渲染卡片（loading 优先）", () => {
    mockHookFn({ loading: true, perms: [makePermRequest()] });
    render(<AgentRunPanel {...PANEL_PROPS} />);

    expect(screen.getByText("加载日志中...")).toBeInTheDocument();
    // loading 分支在 hasPermissionCards 之前，卡片不渲染
    expect(screen.queryByText("工具调用审批")).not.toBeInTheDocument();
  });

  it("FR-03 透传：title/emptyText/actions/isLive 透传到 AgentLogViewer", () => {
    mockHookFn({ perms: [], logs: [] });
    render(
      <AgentRunPanel
        workspaceId="ws-1"
        runId="run-1"
        isActive
        title="Bootstrap run"
        emptyText="暂无日志"
        isLive
        actions={<div data-testid="panel-actions">act</div>}
      />,
    );

    // title
    expect(screen.getByText("Bootstrap run")).toBeInTheDocument();
    // LIVE 徽标（agent-log-viewer.tsx:461-465）
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    // actions 节点
    expect(screen.getByTestId("panel-actions")).toBeInTheDocument();
    // perms=[] 且 logs=[] → 显示 emptyText
    expect(screen.getByText("暂无日志")).toBeInTheDocument();
  });

  it("边界：runId=null → 不渲染卡片也不抛错", () => {
    mockHookFn({ perms: [], logs: [] });
    // AgentRunPanel 允许 runId=null；hook 内部 guard 不连 SSE
    expect(() =>
      render(
        <AgentRunPanel
          workspaceId="ws-1"
          runId={null}
          isActive={false}
          title="未选定 run"
          emptyText="请选择一个 run"
        />,
      ),
    ).not.toThrow();

    expect(screen.queryByText("工具调用审批")).not.toBeInTheDocument();
    expect(screen.getByText("请选择一个 run")).toBeInTheDocument();
  });
});
