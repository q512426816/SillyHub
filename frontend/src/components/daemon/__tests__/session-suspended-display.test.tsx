// task-10（2026-08-29-daemon-platform-resilience / design A5+A6 / D-001@v1 /
// D-003@v1）：suspended 会话展示 + 未知状态兜底 测试。
//
// 覆盖验收（对照任务卡 acceptance + 原型⑤⑥）：
//   - 列表徽标：SessionListLayout statusBadge=suspended →「已挂起」；词表外
//     未知值 →「未知状态」兜底（不回显原始英文值、不崩溃）；
//   - 详情（page 模式，浮窗第三消费方同构复用）：suspended → info 横幅
//     「会话已挂起——守护进程不在线…」+ 24h 副行 + 输入禁用（placeholder
//     「等待守护进程恢复后可继续对话…」）+ 头部徽标「已挂起」；挂起横幅
//     抑制通用「离线只读」横幅不叠加；
//   - 恢复翻转（D-001 自动恢复）：suspended → reconnecting（挂起横幅消失、
//     既有恢复中展示接管）→ active（横幅无、输入恢复）；挂起期间 15s 低频
//     轮询（refetchInterval）驱动翻转；
//   - dialog attach：挂起会话不误报「会话恢复失败」（15s 轮询上限不适用），
//     daemon 回归转 active 后横幅消失、输入恢复；
//   - runtime-session-helpers：ACTIVE_SESSION_VIEW_STATUSES 含 suspended
//     （挂起会话保留活跃视图）；canResumeSession 挂起不可手动续聊；
//     resumeDisabledTitle 挂起专用文案；SessionHistoryView 挂起时「继续对话」
//     按钮禁用态；
//   - 未知 status（词表外值）page 详情渲染不崩溃，徽标兜底「未知状态」。
//
// mock 结构与 session-panel-connection.test.tsx（task-09）同款；dialog attach
// 轮询断言用 fake timers + advanceTimersByTimeAsync 冲刷轮询 promise 链。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}));

// fetch-sse 全 mock（agent-stream / 审批面板不真实建流）。
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

// @/lib/daemon：实际模块 + 关键函数覆写（建流 / 详情 / 轮询 / 队列依赖全部
// mock 成空结果，防真实 fetch 噪声）。
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
import { SessionListLayout, type SessionListEntry } from "../session-list-layout";
import {
  ACTIVE_SESSION_VIEW_STATUSES,
  SessionHistoryView,
  canResumeSession,
  isActiveSession,
  resumeDisabledTitle,
} from "../runtime-session-helpers";
import type {
  AgentSessionRead,
  DaemonMachineRead,
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

let connMock: { close: ReturnType<typeof vi.fn>; getLastEventId: () => string | null };

/** 冲刷 page/dialog 建流 prefetch await 链（全 microtask，无需真计时）。 */
async function flushEstablish(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
  expect(daemonMock.streamSession).toHaveBeenCalled();
}

/**
 * 挂起会话详情（page 模式 getAgentSession 返回）。runtime_id 指向离线机器——
 * 同时覆盖「挂起横幅抑制通用离线横幅」断言；status 的 suspended 值来自
 * task-05 后端词表，前端 lib 类型未收口（task-11），测试里按运行时值传。
 */
function suspendedDetail(): Record<string, unknown> {
  return {
    id: "s-1",
    status: "suspended",
    provider: "claude",
    runtime_id: "rt-1",
    agent_session_id: "as-1",
    origin: "chat",
    turn_count: 3,
    title: "挂起会话",
    current_run_id: null,
    workspace_id: null,
    llm_provider_id: null,
    config_snapshot: null,
  };
}

/** 离线机器列表（session.runtime_id=rt-1 所属机器离线）。 */
function offlineMachines(): DaemonMachineRead[] {
  return [
    {
      id: "m-1",
      hostname: "host-1",
      status: "offline",
      runtimes: [{ id: "rt-1", status: "offline" }],
    } as unknown as DaemonMachineRead,
  ];
}

/** 挂起会话 AgentSessionRead（helpers 断言用，字段按需最小化）。 */
function suspendedSession(over: Record<string, unknown> = {}): AgentSessionRead {
  return {
    id: "s-1",
    status: "suspended",
    provider: "claude",
    agent_session_id: "as-1",
    runtime_id: "rt-1",
    ...over,
  } as unknown as AgentSessionRead;
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonMock.getAgentSessionLogs.mockResolvedValue([]);
  daemonMock.fetchSessionQueue.mockResolvedValue([]);
  daemonMock.fetchSessionDialogHistory.mockResolvedValue([]);
  daemonMock.listSessionTeamMissions.mockResolvedValue([]);
  daemonMock.fetchPendingDialogs.mockResolvedValue([]);
  daemonMock.listSessionRuns.mockResolvedValue([]);
  agentLibMock.getAgentRunLogs.mockResolvedValue([]);
  connMock = { close: vi.fn(), getLastEventId: () => null };
  daemonMock.streamSession.mockReturnValue(connMock);
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

/* ────────────────────── 列表徽标（SessionListLayout） ────────────────────── */

describe("SessionListLayout suspended 徽标 + 未知状态兜底（task-10）", () => {
  function renderLayout(items: SessionListEntry[]) {
    render(
      <SessionListLayout
        items={items}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
  }

  it("suspended →「已挂起」徽标（outline 非活跃阶，不显 success）", () => {
    renderLayout([
      {
        id: "s1",
        title: "挂起的会话",
        statusBadge: "suspended",
        secondaryText: "Claude · 3 轮",
        lastActiveAt: null,
      },
    ]);
    expect(screen.getByText("已挂起")).toBeInTheDocument();
    const badge = screen.getByText("已挂起").closest("span");
    // outline 阶无 success 类（对齐既有 ended 非活跃样式路径）。
    expect(badge?.className).not.toContain("bg-success");
  });

  it("词表外未知 status → 兜底「未知状态」（不回显原始英文值）", () => {
    renderLayout([
      {
        id: "s2",
        title: "奇怪的会话",
        statusBadge: "flux-capacitor",
        secondaryText: "",
        lastActiveAt: null,
      },
    ]);
    expect(screen.getByText("未知状态")).toBeInTheDocument();
    expect(screen.queryByText("flux-capacitor")).toBeNull();
  });
});

/* ────────────────────── helpers（活跃视图词表 + 续聊按钮） ────────────────────── */

describe("runtime-session-helpers suspended 词表（task-10 / D-001）", () => {
  it("ACTIVE_SESSION_VIEW_STATUSES 含 suspended——挂起会话保留活跃视图", () => {
    expect(ACTIVE_SESSION_VIEW_STATUSES.has("suspended")).toBe(true);
    expect(isActiveSession(suspendedSession())).toBe(true);
  });

  it("canResumeSession：suspended 不可手动续聊（daemon 回归自动恢复）", () => {
    // 同一会话 ended 可续聊、suspended 不可——对照锁定词表语义。
    expect(canResumeSession(suspendedSession())).toBe(false);
    expect(
      canResumeSession(suspendedSession({ status: "ended" })),
    ).toBe(true);
  });

  it("resumeDisabledTitle：suspended 专用文案（非「不支持续聊」）", () => {
    expect(resumeDisabledTitle(suspendedSession())).toBe(
      "会话已挂起，守护进程重新上线后将自动恢复",
    );
  });

  it("SessionHistoryView：suspended →「继续对话」按钮显示禁用态 + title 说明", () => {
    render(
      <SessionHistoryView
        session={suspendedSession()}
        logs={[]}
        loading={false}
        error={null}
        onClose={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    const btn = screen.getByTitle("会话已挂起，守护进程重新上线后将自动恢复");
    expect(btn).toBeDisabled();
    expect(screen.getByText("继续对话")).toBeInTheDocument();
  });
});

/* ────────────────────── 详情（page 模式；浮窗第三消费方同构复用） ────────────────────── */

describe("SessionPanel（page）suspended 横幅 + 输入禁用（task-10 / 原型⑤）", () => {
  it("suspended：info 横幅（含 24h 副行）+ 输入禁用占位 + 头部「已挂起」徽标；抑制通用离线横幅", async () => {
    daemonMock.getAgentSession.mockResolvedValue(suspendedDetail());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SessionPanel
          mode="page"
          sessionId="s-1"
          machines={offlineMachines()}
          llmProviders={[]}
        />
      </QueryClientProvider>,
    );
    await flushEstablish();

    // 挂起横幅（主行 + 24h 副行）
    expect(
      screen.getByText("会话已挂起——守护进程不在线，重新启动后会话将自动恢复"),
    ).toBeInTheDocument();
    expect(screen.getByText(/挂起超过 24 小时才会被标记为失败/)).toBeInTheDocument();
    // 头部徽标「已挂起」
    expect(screen.getByText("已挂起")).toBeInTheDocument();
    // 输入禁用 + 占位文案（原型⑤）
    const ta = screen.getByPlaceholderText(
      "等待守护进程恢复后可继续对话…",
    ) as HTMLTextAreaElement;
    expect(ta.disabled).toBe(true);
    // 挂起状态权威（backend 已判定 daemon 离线）：通用「离线只读」横幅不再叠加
    expect(screen.queryByText(/当前离线 —— 可浏览历史消息/)).toBeNull();
    // 不显示终态「重新开启」横幅（suspended 恢复自动完成，无手动入口）
    expect(screen.queryByText(/会话恢复超时/)).toBeNull();
    expect(screen.queryByText(/可浏览历史消息/)).toBeNull();
  });

  it("恢复翻转：suspended → reconnecting（挂起横幅消失、既有恢复中展示接管）→ active（输入恢复）", async () => {
    daemonMock.getAgentSession.mockResolvedValue(suspendedDetail());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // machines 空 → machineOnline 恒真，聚焦状态机翻转（离线机器对横幅的
    // 抑制交互由首用例锁定）。
    // 每次构造新元素字面量（rerender 同一元素引用会命中 React bail-out）
    const makeTree = () => (
      <QueryClientProvider client={qc}>
        <SessionPanel mode="page" sessionId="s-1" machines={[]} llmProviders={[]} />
      </QueryClientProvider>
    );
    const view = render(makeTree());
    await flushEstablish();
    expect(screen.getByText(/会话已挂起/)).toBeInTheDocument();

    // daemon 回归 → recover：suspended → reconnecting（既有恢复中逻辑不变）。
    // setQueryData 翻转详情缓存 + rerender 落地渲染（react-query 观察者通知
    // 在本测试环境不驱动重渲染；轮询行为由下一用例单独锁定）。
    await act(async () => {
      qc.setQueryData(
        ["agentSessionDetail", "s-1"],
        { ...suspendedDetail(), status: "reconnecting" },
      );
      view.rerender(makeTree());
    });
    expect(screen.queryByText(/会话已挂起/)).toBeNull();
    // 既有恢复中展示（复用，不重复加横幅）：徽标「恢复中」+ 排队占位
    expect(screen.getByText("恢复中")).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText(/恢复会话中/) as HTMLTextAreaElement).disabled,
    ).toBe(false);

    // restoreAndReconnect 确认：reconnecting → active，输入恢复常驻占位
    await act(async () => {
      qc.setQueryData(
        ["agentSessionDetail", "s-1"],
        { ...suspendedDetail(), status: "active" },
      );
      view.rerender(makeTree());
    });
    expect(screen.queryByText(/会话已挂起/)).toBeNull();
    expect(screen.getByText("活跃")).toBeInTheDocument();
    const ta2 = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
    expect(ta2.disabled).toBe(false);
  });

  it("挂起期间 15s 低频轮询：refetchInterval 到点拉取详情并带回新状态（SSE 只推轮次事件）", async () => {
    vi.useFakeTimers();
    try {
      daemonMock.getAgentSession.mockResolvedValue(suspendedDetail());
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <SessionPanel mode="page" sessionId="s-1" machines={[]} llmProviders={[]} />
        </QueryClientProvider>,
      );
      await flushEstablish();
      expect(screen.getByText(/会话已挂起/)).toBeInTheDocument();
      const callsAfterMount = daemonMock.getAgentSession.mock.calls.length;

      // 未满 15s：挂起低频轮询不触发（非 pending/reconnecting 的 1.5s 高频档）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(daemonMock.getAgentSession.mock.calls.length).toBe(callsAfterMount);

      // 满 15s：低频轮询触发详情拉取；daemon 回归后该轮带回 reconnecting
      daemonMock.getAgentSession.mockResolvedValue({
        ...suspendedDetail(),
        status: "reconnecting",
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(daemonMock.getAgentSession.mock.calls.length).toBe(callsAfterMount + 1);
      expect(qc.getQueryData(["agentSessionDetail", "s-1"])).toMatchObject({
        status: "reconnecting",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("词表外未知 status：不崩溃，徽标兜底「未知状态」（不误标恢复中）", async () => {
    daemonMock.getAgentSession.mockResolvedValue({
      ...suspendedDetail(),
      status: "flux-capacitor",
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SessionPanel mode="page" sessionId="s-1" machines={[]} llmProviders={[]} />
      </QueryClientProvider>,
    );
    await flushEstablish();

    expect(screen.getByText("未知状态")).toBeInTheDocument();
    expect(screen.queryByText("恢复中")).toBeNull();
    expect(screen.queryByText(/会话已挂起/)).toBeNull();
  });
});

/* ────────────────────── dialog attach（挂起不误报恢复失败） ────────────────────── */

describe("SessionPanel（dialog）attach 挂起会话（task-10 / 原型⑤⑥）", () => {
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("挂起：横幅 + 输入禁用；超过 15s attach 轮询上限不误报「恢复失败」；回归后自动恢复输入", async () => {
    vi.useFakeTimers();
    try {
      daemonMock.getAgentSession.mockResolvedValue(suspendedDetail());
      render(
        <SessionPanel
          mode="dialog"
          sessionId="s-1"
          {...baseDialogProps}
          initialTurns={[]}
        />,
      );
      await flushEstablish();

      // 首个 attach 轮询 tick（1.5s）识别挂起 → 横幅 + 输入禁用
      await advance(1500);
      expect(
        screen.getByText("会话已挂起——守护进程不在线，重新启动后会话将自动恢复"),
      ).toBeInTheDocument();
      const ta = screen.getByPlaceholderText(
        "等待守护进程恢复后可继续对话…",
      ) as HTMLTextAreaElement;
      expect(ta.disabled).toBe(true);

      // 挂起窗口以小时计：远超 ATTACH_POLL_TIMEOUT（15s）仍挂起展示，
      // 不落入「会话恢复失败，可能上下文已失效」误报。
      await advance(60_000);
      expect(screen.getByText(/会话已挂起/)).toBeInTheDocument();
      expect(screen.queryByText(/会话恢复失败/)).toBeNull();

      // daemon 回归 → active：横幅消失、输入恢复
      daemonMock.getAgentSession.mockResolvedValue({
        ...suspendedDetail(),
        status: "active",
      });
      await advance(1500);
      expect(screen.queryByText(/会话已挂起/)).toBeNull();
      const ta2 = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
      expect(ta2.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
