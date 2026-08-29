// 2026-08-29-session-usage-stats task-04（design Wave 2 / R-04 / FR-02 / FR-03 /
// D-001@v1）：SessionUsageBar 在 session-panel 双模式的挂载点 + 轮次终态
// refreshSignal 递增 测试。
//
// 覆盖验收：
//   - page 模式：会话头部下方渲染点存在，stub 收到当前会话 sessionId；
//   - dialog 模式：输入框上方渲染点存在（无 QueryClientProvider 环境——
//     dialog 渲染路径零 react-query 铁律，R-04）；
//   - page 轮次终态（fire streamHandlers.onTurnCompleted，即 SSE
//     turn_completed 事件处理路径）→ stub 收到的 refreshSignal 递增；
//   - dialog 轮次终态同款递增（dialog 分支独立 state）；
//   - 面板测试把用量条 stub 掉：不应触发真实 getSessionUsage 取数
//     （取数 / 重取行为归 session-usage-bar.test.tsx 组件测试）。
//
// mock 结构与 session-panel-connection.test.tsx（task-09）同款；另加
// vi.mock("../session-usage-bar") 把用量条换成带 data-testid 的探针
// （props 经 data-* 透出供断言）。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}));

// SessionUsageBar stub：渲染成探针节点，sessionId / refreshSignal 经
// data-* 透出（挂载点 + 信号递增断言都从 DOM 读，不依赖闭包捕获）。
vi.mock("../session-usage-bar", () => ({
  SessionUsageBar: (props: { sessionId: string; refreshSignal?: number }) => (
    <div
      data-testid="session-usage-bar-stub"
      data-session-id={props.sessionId}
      data-refresh-signal={String(props.refreshSignal ?? 0)}
    />
  ),
}));

// fetch-sse 全 mock（审批面板 / agent-stream 不真实建流）。
const sseMock = vi.hoisted(() => ({ fetchSse: vi.fn() }));
vi.mock("@/lib/fetch-sse", () => ({ fetchSse: sseMock.fetchSse }));

// zustand session store mock：useSession(selector) 与 useSession.getState() 双形态。
const sessionStoreMock = vi.hoisted(() => ({
  state: {
    accessToken: "test-token" as string | null,
    refreshToken: "refresh-token",
    hydrated: true,
  },
}));
vi.mock("@/stores/session", () => ({
  useSession: Object.assign(
    (sel: (s: unknown) => unknown) => sel(sessionStoreMock.state),
    { getState: () => sessionStoreMock.state },
  ),
}));

// @/lib/agent（agent-stream 预取日志）：默认空数组。
const agentLibMock = vi.hoisted(() => ({ getAgentRunLogs: vi.fn() }));
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return { ...actual, getAgentRunLogs: agentLibMock.getAgentRunLogs };
});

// @/lib/daemon：实际模块 + 关键函数覆写（streamSession 捕获 handlers；对账 /
// 轮询 / 队列依赖全部 mock 成空结果，防真实 fetch 噪声。getSessionUsage 一并
// 覆写并断言「未被调用」——组件已 stub，面板测试不应触发真实取数）。
const daemonMock = vi.hoisted(() => ({
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  listSessionRuns: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionQueue: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  getSessionUsage: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...daemonMock };
});

import { SessionPanel } from "../session-panel";
import type {
  SessionStreamEnvelope,
  SessionStreamHandlers,
} from "@/lib/daemon";

/* ────────────────────── 共用工具 ────────────────────── */

const baseDialogProps = {
  providers: ["claude"],
  defaultProvider: "claude",
  model: null,
  onModelChange: vi.fn(),
  hasOnlineProvider: true,
  onSessionCreated: vi.fn(),
  onSessionReset: vi.fn(),
};

let streamHandlers: SessionStreamHandlers | null = null;

function installStreamMock(): void {
  const connMock = {
    close: vi.fn(),
    getLastEventId: () => null,
    resync: vi.fn(),
  };
  daemonMock.streamSession.mockImplementation(
    (_sid: string, handlers: SessionStreamHandlers) => {
      streamHandlers = handlers;
      return connMock;
    },
  );
}

/** 冲刷 page/dialog 建流 prefetch await 链（全 microtask，无需真计时）。 */
async function flushEstablish(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
  expect(daemonMock.streamSession).toHaveBeenCalled();
}

function env(
  event: string,
  over: Partial<SessionStreamEnvelope> = {},
): SessionStreamEnvelope {
  return {
    event,
    session_id: "s-1",
    run_id: "r-1",
    turn: 1,
    log_id: null,
    timestamp: "2026-08-29T00:00:00Z",
    channel: null,
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    ...over,
  } as SessionStreamEnvelope;
}

/** page 模式会话详情（getAgentSession 返回；active 常规会话，字段最小齐备）。 */
function activeDetail(): Record<string, unknown> {
  return {
    id: "s-1",
    status: "active",
    provider: "claude",
    runtime_id: null,
    agent_session_id: "as-1",
    origin: "chat",
    turn_count: 3,
    title: "用量条挂载会话",
    current_run_id: null,
    workspace_id: null,
    llm_provider_id: null,
    config_snapshot: null,
  };
}

/** 用量条探针（渲染点唯一，直接定位后读 data-*）。 */
function usageStub(): HTMLElement {
  return screen.getByTestId("session-usage-bar-stub");
}

/** fire 轮次终态（SSE turn_completed 处理路径；async act 冲刷队列刷新链）。 */
async function fireTurnCompleted(): Promise<void> {
  await act(async () => {
    streamHandlers!.onTurnCompleted!(
      env("turn_completed", { status: "completed" }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonMock.getAgentSessionLogs.mockResolvedValue([]);
  daemonMock.fetchSessionQueue.mockResolvedValue([]);
  daemonMock.fetchSessionDialogHistory.mockResolvedValue([]);
  daemonMock.listSessionTeamMissions.mockResolvedValue([]);
  daemonMock.fetchPendingDialogs.mockResolvedValue([]);
  daemonMock.listSessionRuns.mockResolvedValue([]);
  daemonMock.getAgentSession.mockResolvedValue(activeDetail());
  agentLibMock.getAgentRunLogs.mockResolvedValue([]);
  streamHandlers = null;
  installStreamMock();
  sseMock.fetchSse.mockImplementation(
    () =>
      ({
        onmessage: null,
        onopen: null,
        onerror: null,
        addEventListener: () => () => {},
        close: () => {},
        readyState: 1,
      }) as never,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/* ────────────────────── 挂载点（page / dialog） ────────────────────── */

describe("SessionUsageBar 挂载点（2026-08-29-session-usage-stats task-04）", () => {
  it("page 模式：会话头部下方渲染，收到当前会话 sessionId；不触发真实取数", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <SessionPanel mode="page" sessionId="s-1" machines={[]} llmProviders={[]} />
      </QueryClientProvider>,
    );
    await flushEstablish();

    expect(usageStub()).toHaveAttribute("data-session-id", "s-1");
    // 面板测试已 stub 用量条：不应触发真实 getSessionUsage 取数。
    expect(daemonMock.getSessionUsage).not.toHaveBeenCalled();
  });

  it("dialog 模式：输入框上方渲染（无 QueryClientProvider 环境，零 react-query）", async () => {
    render(
      <SessionPanel
        mode="dialog"
        sessionId="s-1"
        {...baseDialogProps}
        initialTurns={[]}
      />,
    );
    await flushEstablish();

    expect(usageStub()).toHaveAttribute("data-session-id", "s-1");
    expect(daemonMock.getSessionUsage).not.toHaveBeenCalled();
  });

  it("page 轮次终态（turn_completed）→ refreshSignal 递增（stub 收到的信号 +1）", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <SessionPanel mode="page" sessionId="s-1" machines={[]} llmProviders={[]} />
      </QueryClientProvider>,
    );
    await flushEstablish();
    expect(usageStub()).toHaveAttribute("data-refresh-signal", "0");

    await fireTurnCompleted();
    expect(usageStub()).toHaveAttribute("data-refresh-signal", "1");

    // 再一轮终态：继续递增（每轮触发一次重取信号）。
    await fireTurnCompleted();
    expect(usageStub()).toHaveAttribute("data-refresh-signal", "2");
  });

  it("dialog 轮次终态（turn_completed）→ refreshSignal 递增（dialog 独立 state）", async () => {
    render(
      <SessionPanel
        mode="dialog"
        sessionId="s-1"
        {...baseDialogProps}
        initialTurns={[]}
      />,
    );
    await flushEstablish();
    expect(usageStub()).toHaveAttribute("data-refresh-signal", "0");

    await fireTurnCompleted();
    expect(usageStub()).toHaveAttribute("data-refresh-signal", "1");
  });
});
