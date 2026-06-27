// tests/components/__tests__/agent-run-panel.test.tsx
// task-16 / FR-11：AgentRunPanel token 徽标展示单测。
//
// 依据：
//   - .sillyspec/changes/2026-06-22-agent-run-pipeline-fix/task-16.md §TDD
//   - design.md §5.5 Token 消耗展示
//   - requirements.md FR-11（agent-run 日志面板可见 input/output token 消耗）
//
// 覆盖：
//   - run 有 token 时徽标显示格式化后的 ↓ input | ↑ output
//   - run token 为 null 时显示 "—" 占位
//   - runId=null 时不渲染徽标（边界 4）
//   - 大数字格式化（1234 → 1.2k，边界 3）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ────────────────────────────────────────────────────────────────────────────
// hoisted：mock useAgentRunStream 返回空流状态，避免真实 SSE/网络副作用。
// ────────────────────────────────────────────────────────────────────────────
const hoisted = vi.hoisted(() => {
  return {
    getAgentRunMock: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  };
});

// mock useAgentRunStream：返回最小可用流（panel 只用到 dismissPerm / input 字段；其余置空）
vi.mock("@/lib/use-agent-run-stream", () => ({
  useAgentRunStream: () => ({
    logs: [],
    status: null,
    streaming: false,
    loading: false,
    error: null,
    perms: [],
    dismissPerm: () => {},
    input: {
      values: {},
      submitting: {},
      errors: {},
      replied: new Set<string>(),
      set: () => {},
      submit: async () => {},
    },
    clear: () => {},
  }),
}));

// mock @/lib/agent 的 getAgentRun（panel 内部 useEffect 轮询拉 token）
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    getAgentRun: hoisted.getAgentRunMock,
  };
});

// mock AgentLogViewer：让 summary 直接在 DOM 出现，便于断言徽标渲染
vi.mock("@/components/agent-log-viewer", () => ({
  AgentLogViewer: ({
    summary,
  }: {
    summary?: React.ReactNode;
  }) => <div data-testid="viewer">{summary}</div>,
}));

// mock session store（panel 间接依赖，虽 useAgentRunStream 已 mock）
vi.mock("@/stores/session", () => ({
  useSession: { getState: () => ({ accessToken: "test-token" }) },
}));

import { AgentRunPanel } from "@/components/agent-run-panel";

beforeEach(() => {
  hoisted.getAgentRunMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("task-16: AgentRunPanel token 徽标展示 (FR-11)", () => {
  it("run 有 token 时徽标显示格式化后的 ↓ input | ↑ output", async () => {
    hoisted.getAgentRunMock.mockResolvedValue({
      input_tokens: 1234,
      output_tokens: 567,
    });
    render(
      <AgentRunPanel
        workspaceId="ws"
        runId="r1"
        isActive={false}
        title="t"
      />,
    );
    // 等待徽标渲染（useEffect 异步 fetchUsage）
    expect(await screen.findByText(/1\.2k/)).toBeInTheDocument();
    expect(screen.getByText(/567/)).toBeInTheDocument();
    // 两个方向符号都出现
    expect(screen.getByText(/↓/)).toBeInTheDocument();
    expect(screen.getByText(/↑/)).toBeInTheDocument();
  });

  it("run token 为 null 时显示 — 占位", async () => {
    hoisted.getAgentRunMock.mockResolvedValue({
      input_tokens: null,
      output_tokens: null,
    });
    render(
      <AgentRunPanel
        workspaceId="ws"
        runId="r1"
        isActive={false}
        title="t"
      />,
    );
    // 至少两个 "—"（input + output）
    const placeholders = await screen.findAllByText(/—/);
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
  });

  it("0 token 与 null 不混淆（0 显示为 0）", async () => {
    hoisted.getAgentRunMock.mockResolvedValue({
      input_tokens: 0,
      output_tokens: 0,
      // 四维 badge：cache 维度同样为 0，避免 undefined 误显 "—" 占位。
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
    render(
      <AgentRunPanel
        workspaceId="ws"
        runId="r1"
        isActive={false}
        title="t"
      />,
    );
    // 徽标 DOM 里出现 "0"（徽标渲染 ↓ 0 | ↑ 0，相邻 Text node 不影响包含判断）
    const badge = await screen.findByTestId("token-usage-badge");
    expect(badge.textContent).toContain("0");
    // 不出现 "—" 占位（与 null 场景区分）
    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });

  it("runId=null 时不渲染徽标（不调 getAgentRun）", () => {
    render(
      <AgentRunPanel
        workspaceId="ws"
        runId={null}
        isActive={false}
        title="t"
      />,
    );
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
    expect(hoisted.getAgentRunMock).not.toHaveBeenCalled();
  });

  it("大数字 ≥ 1M 显示 M 后缀", async () => {
    hoisted.getAgentRunMock.mockResolvedValue({
      input_tokens: 1_500_000,
      output_tokens: 23_456_789,
    });
    render(
      <AgentRunPanel
        workspaceId="ws"
        runId="r1"
        isActive={false}
        title="t"
      />,
    );
    expect(await screen.findByText(/1\.5M/)).toBeInTheDocument();
    expect(screen.getByText(/23\.5M/)).toBeInTheDocument();
  });
});
