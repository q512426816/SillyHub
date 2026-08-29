// task-09（2026-08-29-daemon-platform-resilience / design A6 / D-003@v1）：
// SessionPanel 连接横幅（page / dialog）+ 运行轮看门狗 + 审批面板 SSE 重连补拉
// + agent-stream run 流预算重置 测试。
//
// 覆盖验收：
//   - 断线期间重连中横幅出现（第 N 次尝试）→ 恢复切 success → 2s 自动消失（时序）；
//   - 看门狗 90s 无事件触发一次对账（getAgentSession + listSessionRuns）；对账发现
//     终态走 resync 刷新且不本地伪造终态；连续 3 轮（30s 间隔）仍 running 且 SSE
//     断开 → 「本轮长时间无响应」提示；轮终态 / 卸载清理计时器；
//   - AgentRunStreamClient 收到成功事件后 retryCount 归零（5 次耗尽永久停连修复）；
//   - 审批面板 SSE 断开按退避自动重连，重连成功补拉 dialogs。
//
// fake timers 模式与 sessions/__tests__/page.test.tsx 同款（vi.useFakeTimers()
// 默认连 Date 一起 fake——看门狗 idle 时长依赖 Date.now；advance 用
// advanceTimersByTimeAsync 以冲刷重连 / 对账 promise 链）。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}));

// fetch-sse 全 mock：审批面板重连与 agent-stream 重连都消费可控的假连接。
const sseMock = vi.hoisted(() => ({ fetchSse: vi.fn() }));
vi.mock("@/lib/fetch-sse", () => ({ fetchSse: sseMock.fetchSse }));

// zustand session store mock：审批面板 useSession(selector) 与 agent-stream /
// daemon 的 useSession.getState() 双形态都要可用。
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
// 轮询 / 队列依赖全部 mock 成空结果，防真实 fetch 噪声）。
const daemonMock = vi.hoisted(() => ({
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  listSessionRuns: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionQueue: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionTeamMissions: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...daemonMock };
});

import { SessionPanel } from "../session-panel";
import { SessionPermissionPanel } from "@/components/permissions/session-permission-panel";
import { AgentRunStreamClient } from "@/lib/agent-stream";
import type {
  SessionStreamEnvelope,
  SessionStreamHandlers,
  SessionStreamStatus,
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

interface FakeConn {
  close: ReturnType<typeof vi.fn>;
  getLastEventId: () => string | null;
  resync: ReturnType<typeof vi.fn>;
}
let connMock: FakeConn;
let streamHandlers: SessionStreamHandlers | null = null;

function installStreamMock(): void {
  connMock = { close: vi.fn(), getLastEventId: () => null, resync: vi.fn() };
  daemonMock.streamSession.mockImplementation(
    (_sid: string, handlers: SessionStreamHandlers) => {
      streamHandlers = handlers;
      return connMock;
    },
  );
}

/** 冲刷 establishStream 的 prefetch await 链（全 microtask，无需真计时）。 */
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

function fireStatus(s: SessionStreamStatus, attempt?: number): void {
  act(() => {
    streamHandlers!.onStatusChange!(s, attempt);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // 窗口尾部落地的轮询 promise（如队列 5s 刷新）在 0 推进里冲刷，避免 act 外 setState
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** fake SSE 连接（审批面板 / agent-stream 测试用）。 */
interface FakeSseConn {
  onmessage: ((e: { data: string; lastEventId?: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: ((ev: { status?: number }) => void) | null;
  addEventListener: (type: string, listener: (e: { data: string }) => void) => () => void;
  close: () => void;
  readyState: 0 | 1 | 2;
}

function makeSseConn(): FakeSseConn {
  return {
    onmessage: null,
    onopen: null,
    onerror: null,
    addEventListener: () => () => {},
    close: () => {},
    readyState: 1,
  };
}

/** 每次 fetchSse 调用产出一条新假连接并记录（重连断言按调用序取回）。 */
function installSseFactory(): FakeSseConn[] {
  const conns: FakeSseConn[] = [];
  sseMock.fetchSse.mockImplementation(() => {
    const c = makeSseConn();
    conns.push(c);
    return c;
  });
  return conns;
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonMock.getAgentSessionLogs.mockResolvedValue([]);
  daemonMock.fetchSessionQueue.mockResolvedValue([]);
  daemonMock.fetchSessionDialogHistory.mockResolvedValue([]);
  daemonMock.listSessionTeamMissions.mockResolvedValue([]);
  daemonMock.fetchPendingDialogs.mockResolvedValue([]);
  daemonMock.getAgentSession.mockResolvedValue({ id: "s-1", status: "active" });
  daemonMock.listSessionRuns.mockResolvedValue([{ id: "r-1", status: "running" }]);
  agentLibMock.getAgentRunLogs.mockResolvedValue([]);
  streamHandlers = null;
  installStreamMock();
  installSseFactory();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ────────────────────── 连接横幅（dialog 模式） ────────────────────── */

describe("SessionPanel（dialog）连接横幅（task-09 / design A6）", () => {
  it("断线 → 重连中横幅（warning，第 N 次尝试）→ 恢复 → success 横幅 2s 自动消失", async () => {
    vi.useFakeTimers();
    try {
      render(
        <SessionPanel
          mode="dialog"
          sessionId="s-1"
          {...baseDialogProps}
          initialTurns={[]}
        />,
      );
      await flushEstablish();

      // 初始（live）：无横幅
      expect(screen.queryByText(/实时连接已断开/)).toBeNull();

      // 第一次断线：第 1 次尝试
      fireStatus("reconnecting", 1);
      expect(screen.getByText(/实时连接已断开，正在重连/)).toBeInTheDocument();
      expect(screen.getByText(/第 1 次尝试/)).toBeInTheDocument();

      // 退避升级：第 2 次尝试（文案随 attempt 更新）
      fireStatus("reconnecting", 2);
      expect(screen.getByText(/第 2 次尝试/)).toBeInTheDocument();

      // 重连成功：warning 消失、success「连接已恢复，正在同步…」出现
      fireStatus("reconnected");
      expect(screen.queryByText(/实时连接已断开/)).toBeNull();
      expect(screen.getByText(/连接已恢复，正在同步/)).toBeInTheDocument();

      // 未满 2s：仍在
      await advance(1999);
      expect(screen.getByText(/连接已恢复，正在同步/)).toBeInTheDocument();
      // 满 2s：自动消失
      await advance(1);
      expect(screen.queryByText(/连接已恢复，正在同步/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnected 后收到实时事件（live）→ 横幅立即收起，2s 后不复现", async () => {
    vi.useFakeTimers();
    try {
      render(
        <SessionPanel
          mode="dialog"
          sessionId="s-1"
          {...baseDialogProps}
          initialTurns={[]}
        />,
      );
      await flushEstablish();

      fireStatus("reconnecting", 1);
      fireStatus("reconnected");
      expect(screen.getByText(/连接已恢复，正在同步/)).toBeInTheDocument();

      // live 早于 2s 到达：横幅立即收起
      fireStatus("live");
      expect(screen.queryByText(/连接已恢复，正在同步/)).toBeNull();

      // 2s 计时到期后不复现（live 覆盖了 reconnected 的自动消失定时器语义）
      await advance(2100);
      expect(screen.queryByText(/连接已恢复，正在同步/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ────────────────────── 连接横幅（page 模式） ────────────────────── */

describe("SessionPanel（page）连接横幅（task-09 / design A6）", () => {
  it("page 模式同款连接横幅（复用离线只读横幅样式位）", async () => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={qc}>
          <SessionPanel mode="page" sessionId="s-1" machines={[]} llmProviders={[]} />
        </QueryClientProvider>,
      );
      await flushEstablish();

      fireStatus("reconnecting", 2);
      expect(screen.getByText(/实时连接已断开，正在重连/)).toBeInTheDocument();
      expect(screen.getByText(/第 2 次尝试/)).toBeInTheDocument();

      fireStatus("reconnected");
      expect(screen.getByText(/连接已恢复，正在同步/)).toBeInTheDocument();
      await advance(2000);
      expect(screen.queryByText(/连接已恢复，正在同步/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ────────────────────── 运行轮看门狗 ────────────────────── */

describe("SessionPanel（dialog）运行轮看门狗（task-09 / design A6）", () => {
  async function renderRunningDialog() {
    render(
      <SessionPanel
        mode="dialog"
        sessionId="s-1"
        {...baseDialogProps}
        initialTurns={[]}
      />,
    );
    await flushEstablish();
    // 进入 running 轮（currentRunId 置位 → 看门狗 90s 计时从即刻起算）。
    // 注：attach 轮询（1.5s 一次性）会多调一次 getAgentSession，不碰 listSessionRuns
    // ——对账计数断言统一走 listSessionRuns。async act：onTurnStarted 内联的队列
    // 刷新（void load）promise 链需在 act 内冲刷。
    await act(async () => {
      streamHandlers!.onTurnStarted!(env("turn_started"));
    });
  }

  it("90s 无事件触发一次对账；对账仍 running → 不 resync、不提示、不伪造终态", async () => {
    vi.useFakeTimers();
    try {
      await renderRunningDialog();
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(0);

      // <90s：不对账
      await advance(89_999);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(0);

      // 满 90s：对账一次（getAgentSession + listSessionRuns）
      await advance(1);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(1);
      expect(daemonMock.getAgentSession).toHaveBeenCalledTimes(2); // attach 轮询 1 + 看门狗 1

      // run 仍 running（mock 默认）：走不到 resync、无长时间无响应提示
      expect(connMock.resync).not.toHaveBeenCalled();
      expect(screen.queryByText(/本轮长时间无响应/)).toBeNull();

      // 不伪造终态：turn 仍 running（打断按钮可用，未被本地标成终态）
      const interrupt = screen.getByTitle("打断本轮（session 保持 active）");
      expect((interrupt as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("SSE 断开 + 连续 3 轮（30s 间隔）仍 running → 显示「本轮长时间无响应」提示", async () => {
    vi.useFakeTimers();
    try {
      await renderRunningDialog();
      fireStatus("reconnecting", 1); // SSE 断开态

      // 第 1 轮（90s）：对账、无提示
      await advance(90_000);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/本轮长时间无响应/)).toBeNull();

      // 第 2 轮（+30s）：对账、无提示
      await advance(30_000);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/本轮长时间无响应/)).toBeNull();

      // 第 3 轮（+30s）：连续 3 轮仍 running 且 SSE 断开 → 提示（accent，不伪造终态）
      await advance(30_000);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(3);
      expect(screen.getByText(/本轮长时间无响应，正在与平台核对/)).toBeInTheDocument();
      // 不伪造终态：打断按钮仍可用（turn 未被本地标终态）
      const interrupt = screen.getByTitle("打断本轮（session 保持 active）");
      expect((interrupt as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("对账发现 run 已终态 → 走既有 resync 路径刷新（connection.resync），不本地伪造", async () => {
    vi.useFakeTimers();
    try {
      daemonMock.listSessionRuns.mockResolvedValue([
        { id: "r-1", status: "completed" },
      ]);
      await renderRunningDialog();

      await advance(90_000);
      expect(connMock.resync).toHaveBeenCalledTimes(1);

      // SSE 未断开（live）→ 即便持续无事件也不出现「长时间无响应」提示
      expect(screen.queryByText(/本轮长时间无响应/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("轮终态（turn_completed）→ 看门狗停止：不再对账、提示清除", async () => {
    vi.useFakeTimers();
    try {
      await renderRunningDialog();
      fireStatus("reconnecting", 1);
      await advance(150_000); // 3 轮 → 提示出现
      expect(screen.getByText(/本轮长时间无响应/)).toBeInTheDocument();

      // 轮终态：currentRunId 清空 → 看门狗计时器清理（async act 同上：队列刷新链）
      await act(async () => {
        streamHandlers!.onTurnCompleted!(env("turn_completed", { status: "completed" }));
      });
      expect(screen.queryByText(/本轮长时间无响应/)).toBeNull();

      // 之后 120s 不再有新的对账调用
      await advance(120_000);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(3); // 仅前 3 轮
    } finally {
      vi.useRealTimers();
    }
  });

  it("组件卸载 → 看门狗计时器清理：90s 后不对账", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <SessionPanel
          mode="dialog"
          sessionId="s-1"
          {...baseDialogProps}
          initialTurns={[]}
        />,
      );
      await flushEstablish();
      act(() => {
        streamHandlers!.onTurnStarted!(env("turn_started"));
      });
      unmount();
      await advance(200_000);
      expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ────────────────────── run 流预算重置（agent-stream） ────────────────────── */

describe("AgentRunStreamClient run 流预算重置（task-09 / design A6）", () => {
  it("收到成功事件后 retryCount 归零——短暂断线累计不耗尽，仍可继续连流", async () => {
    vi.useFakeTimers();
    try {
      const client = new AgentRunStreamClient("ws-1", "run-1");
      await client.connect("test-token");
      const conns = sseMock.fetchSse.mock.results.map((r) => r.value as FakeSseConn);
      expect(conns.length).toBe(1);
      conns[0]!.onopen!();
      expect(client.getStatus()).toBe("connected");

      // 第 1 次断线 → 1s 退避后重连
      conns[0]!.onerror!({});
      await vi.advanceTimersByTimeAsync(1000);
      let last = sseMock.fetchSse.mock.results.at(-1)!.value as FakeSseConn;
      last.onopen!();

      // 重连后收到成功事件（预算重置点：此刻内部 retryCount 已 >0，归零为 0）
      last.onmessage!({
        data: JSON.stringify({
          channel: "stdout",
          content: "hello",
          timestamp: "2026-08-29T00:00:00Z",
          log_id: "l-1",
        }),
      });

      // 再连续断线 5 次：若无预算重置，累计 6 次失败达 maxRetries=5 后永久停连
      for (let i = 0; i < 5; i++) {
        (sseMock.fetchSse.mock.results.at(-1)!.value as FakeSseConn).onerror!({});
        await vi.advanceTimersByTimeAsync(20_000);
        (sseMock.fetchSse.mock.results.at(-1)!.value as FakeSseConn).onopen!();
      }

      // 初连 1 + 重连 6（第 1 次断线 + 后续 5 次）= 7 次建流；未进入 error 永久停连
      expect(sseMock.fetchSse).toHaveBeenCalledTimes(7);
      expect(client.getStatus()).not.toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ────────────────────── 审批面板 SSE 重连（session-permission-panel） ────────────────────── */

describe("SessionPermissionPanel SSE 无限退避重连（task-09 / design A6）", () => {
  it("断开后按退避自动重连；重连成功（onopen）补拉 dialogs 并入列表", async () => {
    vi.useFakeTimers();
    try {
      daemonMock.fetchPendingDialogs.mockResolvedValue([
        {
          session_id: "s-1",
          run_id: "r-1",
          request_id: "rq-1",
          tool_name: "Bash",
          input: { command: "ls" },
        },
      ]);
      render(<SessionPermissionPanel sessionIds={["s-1"]} />);
      const conns = sseMock.fetchSse.mock.results.map((r) => r.value as FakeSseConn);
      expect(conns.length).toBe(1);

      // 首连成功不算断线恢复：不补拉
      conns[0]!.onopen!();
      await act(async () => {});
      expect(daemonMock.fetchPendingDialogs).not.toHaveBeenCalled();

      // 断线 → 未到 1s 不重连
      conns[0]!.onerror!({});
      await advance(999);
      expect(sseMock.fetchSse).toHaveBeenCalledTimes(1);

      // 满 1s（RECONNECT_BACKOFF_MS 首档）→ 自动重建连接
      await advance(1);
      expect(sseMock.fetchSse).toHaveBeenCalledTimes(2);
      const conn2 = sseMock.fetchSse.mock.results.at(-1)!.value as FakeSseConn;

      // 重连成功 → 补拉该会话 pending dialogs，卡片并入列表（幂等合并）
      conn2.onopen!();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(daemonMock.fetchPendingDialogs).toHaveBeenCalledWith("s-1");
      expect(document.querySelector('[data-panel-card="rq-1"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("卸载后不再重连（退避定时器清理）", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<SessionPermissionPanel sessionIds={["s-1"]} />);
      const conn1 = sseMock.fetchSse.mock.results.at(-1)!.value as FakeSseConn;
      conn1.onerror!({});
      unmount();
      await advance(5000);
      expect(sseMock.fetchSse).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
