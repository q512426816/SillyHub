/**
 * /sessions 智能体会话总入口页冒烟（2026-08-14-sessions-portal task-10）。
 *
 * 依据：
 *   - app/(dashboard)/sessions/page.tsx（本 task 实现）
 *   - tasks/task-10.md acceptance：两栏渲染、无选中显示 NewSessionForm、选中显示
 *     SessionPanel（含 ConfigBar/UsageBar 挂载）、onCreated/onSelect 两态切换
 *
 * 覆盖：
 *   1. 两栏渲染：左「会话列表」+ 右「新建会话表单」（无选中态）+ 页头标题
 *   2. 点击列表条目 onSelect → 右侧 SessionPanel（会话面板 / 配置控件条 /
 *      ctx-ring / 输入框 / 打断·结束按钮），新建表单隐藏、页头出现「新建会话」
 *   3. 页头「新建会话」→ 回到 NewSessionForm 态
 *   4. NewSessionForm onCreated 流：填消息点「开始会话」→ createSession 带
 *      runtime_id → 右侧切到新会话 SessionPanel（getAgentSession(s-new)）
 *   5. ended 会话 → 已结束横幅 + 重新开启按钮
 *
 * mock 策略（对齐 sessions 组件测试惯例）：
 *   - @/lib/daemon 整模块 mock（页面/列表/表单/控件条消费的全部函数，
 *     streamSession 不建真实 EventSource）
 *   - @/lib/use-daemon-machines、@/lib/agent-profiles（hook 部分）、
 *     @/lib/api/llm-providers mock
 *   - jsdom 虚拟滚动视口桩：session-scroll offsetHeight/offsetWidth 非零
 *     （与 session-list-panel.test.tsx 同款）
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

import SessionsPortalPage from "@/app/(dashboard)/sessions/page";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  streamClose: vi.fn(),
  machinesHook: vi.fn(),
  profilesHook: vi.fn(),
  listProviders: vi.fn(),
  getProviderQuota: vi.fn(),
}));

vi.mock("@/lib/daemon", () => ({
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "" },
    codex: { label: "Codex", icon: "🟢", color: "" },
  },
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  getAgentSession: (...args: unknown[]) => mocks.getAgentSession(...args),
  getAgentSessionLogs: (...args: unknown[]) => mocks.getAgentSessionLogs(...args),
  createSession: (...args: unknown[]) => mocks.createSession(...args),
  injectSession: (...args: unknown[]) => mocks.injectSession(...args),
  interruptSession: (...args: unknown[]) => mocks.interruptSession(...args),
  endSession: (...args: unknown[]) => mocks.endSession(...args),
  reopenSession: (...args: unknown[]) => mocks.reopenSession(...args),
  streamSession: (...args: unknown[]) => mocks.streamSession(...args),
  fetchPendingDialogs: (...args: unknown[]) => mocks.fetchPendingDialogs(...args),
  fetchSessionDialogHistory: (...args: unknown[]) =>
    mocks.fetchSessionDialogHistory(...args),
  listSessionRuns: (...args: unknown[]) => mocks.listSessionRuns(...args),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/agent-profiles", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-profiles")>(
      "@/lib/agent-profiles",
    );
  return {
    ...actual,
    useMineAgentProfiles: () => mocks.profilesHook(),
  };
});

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
  getProviderQuota: (...args: unknown[]) => mocks.getProviderQuota(...args),
}));

// ── jsdom 虚拟滚动桩：scroll 容器给出非零视口（列表条目才进可视区） ────────

const SCROLL_VIEWPORT = { height: 600, width: 320 };
const origOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const origOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      const el = this as HTMLElement;
      if (el.dataset?.testid === "session-scroll") return SCROLL_VIEWPORT.height;
      return origOffsetHeight?.get?.call(el) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      const el = this as HTMLElement;
      if (el.dataset?.testid === "session-scroll") return SCROLL_VIEWPORT.width;
      return origOffsetWidth?.get?.call(el) ?? 0;
    },
  });
});

afterAll(() => {
  if (origOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", origOffsetHeight);
  if (origOffsetWidth)
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", origOffsetWidth);
});

// ── 固件构造 ─────────────────────────────────────────────────────────────

function makeRuntime(
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
  return {
    id: "rt-1",
    display_alias: null,
    name: null,
    provider: "claude",
    version: null,
    os: null,
    arch: null,
    status: "online",
    last_heartbeat_at: null,
    capabilities: null,
    allowed_roots: [],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "machine-1",
    display_alias: null,
    os: "windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-08-15T08:00:00Z",
    version: "1.0.0",
    build_id: null,
    started_at: null,
    created_at: "2026-08-01T00:00:00Z",
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime()],
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<AgentSessionRead> = {},
): AgentSessionRead {
  return {
    id: "s-1",
    runtime_id: "rt-1",
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: "sdk-1",
    config: null,
    // ql-20260817-003：会话属主（发送者「我」判断）。
    user_id: "u-owner",
    config_snapshot: {
      profile_name: "知识经理",
      provider_name: null,
      model: null,
      engine: "claude",
      machine_name: "machine-1",
      agent_name: "Claude Code",
    },
    turn_count: 3,
    created_at: "2026-08-15T08:00:00Z",
    last_active_at: "2026-08-15T09:00:00Z",
    ended_at: null,
    change_id: null,
    workspace_id: null,
    title: "整理这周的会议纪要",
    deleted_at: null,
    current_run_id: null,
    terminating_at: null,
    agent_profile_id: "ap-1",
    llm_provider_id: null,
    ...overrides,
  } as AgentSessionRead;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionsPortalPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 机器：1 台在线（rt-1 claude）+ 1 台带 codex 的在线机器（表单默认机器回退用）
  mocks.machinesHook.mockReturnValue({
    items: [
      makeMachine(),
      makeMachine({
        id: "m-2",
        hostname: "machine-2",
        runtimes: [makeRuntime({ id: "rt-2", provider: "codex" })],
      }),
    ],
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.profilesHook.mockReturnValue({
    profiles: [
      {
        id: "ap-1",
        name: "知识经理",
        visibility: "private",
        provider: "claude",
        system_prompt: "你是知识经理。",
        workspace_id: null,
        workspace_name: null,
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.listProviders.mockResolvedValue([]);
  mocks.getProviderQuota.mockResolvedValue({ quota: null });
  mocks.listAgentSessions.mockResolvedValue({
    items: [makeSession()],
    total: 1,
    limit: 50,
    offset: 0,
  });
  mocks.getAgentSession.mockResolvedValue(makeSession());
  mocks.getAgentSessionLogs.mockResolvedValue([]);
  mocks.createSession.mockResolvedValue({
    session_id: "s-new",
    run_id: "r-new",
    lease_id: "l-new",
    status: "pending",
    stream_url: "/stream",
  });
  mocks.injectSession.mockResolvedValue({
    session_id: "s-1",
    run_id: "r-2",
    status: "pending",
  });
  mocks.interruptSession.mockResolvedValue({
    session_id: "s-1",
    status: "active",
    current_run_id: null,
  });
  mocks.endSession.mockResolvedValue({
    session_id: "s-1",
    status: "ended",
    current_run_id: null,
  });
  mocks.reopenSession.mockResolvedValue({ session_id: "s-1", status: "active" });
  mocks.streamSession.mockReturnValue({
    close: mocks.streamClose,
    getLastEventId: () => null,
  });
  mocks.fetchPendingDialogs.mockResolvedValue([]);
  mocks.fetchSessionDialogHistory.mockResolvedValue([]);
  mocks.listSessionRuns.mockResolvedValue([]);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ── 用例 ─────────────────────────────────────────────────────────────────

describe("SessionsPortalPage 两栏两态组装（task-10 冒烟）", () => {
  it("无选中：左会话列表 + 右新建会话表单 + 页头标题", async () => {
    renderPage();

    // 页头
    expect(screen.getByRole("heading", { name: "智能体会话" })).toBeTruthy();

    // 左栏：列表（标题条目进可视区）
    expect(screen.getByLabelText("会话列表")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "会话 整理这周的会议纪要" })).toBeTruthy();
    });

    // 右栏：新建态表单（四选择器 + 消息输入）
    expect(screen.getByLabelText("新建会话表单")).toBeTruthy();
    expect(screen.getByLabelText("会话消息输入")).toBeTruthy();
    expect(screen.queryByLabelText("会话面板")).toBeNull();
  });

  it("点击列表条目 → SessionPanel（ConfigBar / CtxUsageBar / 输入框挂载），新建表单隐藏", async () => {
    renderPage();
    const row = await screen.findByRole("button", {
      name: "会话 整理这周的会议纪要",
    });
    fireEvent.click(row);

    // 右侧会话面板组装到位
    await waitFor(() => {
      expect(screen.getByLabelText("会话面板")).toBeTruthy();
    });
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
    // 会话态细节：标题 + 配置控件条 + ctx-ring + 输入框 + 打断/结束
    // （标题同时出现在左列表条目与右面板头，取全部命中）
    expect(screen.getAllByText("整理这周的会议纪要").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("会话配置控件条")).toBeTruthy();
    expect(screen.getByTestId("ctx-ring")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("继续追问…（Enter 发送 · Shift+Enter 换行）"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /打断本轮/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /结束会话/ })).toBeTruthy();
    // 页头出现「新建会话」入口（回到新建态）
    expect(screen.getByRole("button", { name: "新建会话" })).toBeTruthy();

    // attach 模式：SSE 建流 + 历史预取 + pending dialogs 恢复
    await waitFor(() => {
      expect(mocks.streamSession).toHaveBeenCalledWith(
        "s-1",
        expect.objectContaining({
          onTurnStarted: expect.any(Function),
          onLog: expect.any(Function),
          onTurnCompleted: expect.any(Function),
        }),
      );
    });
    expect(mocks.getAgentSessionLogs).toHaveBeenCalledWith("s-1");
    expect(mocks.getAgentSession).toHaveBeenCalledWith("s-1");
  });

  it("页头「新建会话」→ 回到 NewSessionForm 态（SSE 关闭）", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("会话面板")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));

    expect(screen.getByLabelText("新建会话表单")).toBeTruthy();
    expect(screen.queryByLabelText("会话面板")).toBeNull();
    expect(mocks.streamClose).toHaveBeenCalled();
  });

  it("NewSessionForm onCreated：开始会话 → createSession(runtime_id) → 切到新会话面板", async () => {
    renderPage();

    // 默认机器自动回退（D-005：最新在线心跳），填首条消息后开始
    const prompt = screen.getByLabelText("会话消息输入");
    fireEvent.change(prompt, { target: { value: "帮我把这个函数重构成 async" } });
    fireEvent.click(screen.getByRole("button", { name: "开始会话" }));

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ runtime_id: "rt-1", prompt: "帮我把这个函数重构成 async" }),
      );
    });

    // onCreated → 右侧切到 s-new 的会话面板
    await waitFor(() => {
      expect(mocks.getAgentSession).toHaveBeenCalledWith("s-new");
    });
    await waitFor(() => {
      expect(screen.getByLabelText("会话面板")).toBeTruthy();
    });
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
  });

  it("已结束会话：显示已结束横幅 + 重新开启按钮", async () => {
    mocks.getAgentSession.mockResolvedValue(
      makeSession({ status: "ended", ended_at: "2026-08-15T09:30:00Z" }),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/会话已结束 —— 可浏览历史消息/)).toBeTruthy();
    });
    const reopenBtn = screen.getByRole("button", { name: /重新开启/ });
    expect(reopenBtn).toBeTruthy();

    // 重新开启 → reopenSession + 详情刷新
    fireEvent.click(reopenBtn);
    await waitFor(() => {
      expect(mocks.reopenSession).toHaveBeenCalledWith("s-1");
    });
  });
});

// ── gap-fix（FR-07 whoLine / FR-08 历史 usage）：attach 轮次快照注入 ──────────

describe("SessionPanel attach 历史 whoLine + usage 注入（gap-fix）", () => {
  function makeHistoryLog(
    id: string,
    runId: string,
    channel: string,
    content: string,
  ) {
    return {
      id,
      run_id: runId,
      timestamp: "2026-08-15T08:00:00Z",
      channel,
      content_redacted: content,
      parent_tool_use_id: null,
      subagent_type: null,
      depth: null,
      tool_kind: null,
    };
  }

  function makeRunItem(overrides: Record<string, unknown> = {}) {
    return {
      id: "r-1",
      status: "completed",
      error_code: null,
      error_detail: null,
      started_at: "2026-08-15T08:00:00Z",
      finished_at: "2026-08-15T08:00:10Z",
      exit_code: 0,
      agent_profile_snapshot: null,
      llm_provider_id: null,
      input_tokens: null,
      output_tokens: null,
      ...overrides,
    };
  }

  it("历史轮 whoLine 按 run 快照渲染（档案快照名 / 会话 agent_name / 供应商名对照）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeHistoryLog("log-1", "r-1", "user_input", "帮我整理这周的会议纪要"),
      makeHistoryLog("log-2", "r-1", "stdout", "已整理完成。"),
    ]);
    mocks.listSessionRuns.mockResolvedValue([
      makeRunItem({
        agent_profile_snapshot: { name: "知识经理", version: 1 },
        llm_provider_id: "lp-1",
        input_tokens: 1500,
        output_tokens: 300,
      }),
    ]);
    mocks.listProviders.mockResolvedValue([{ id: "lp-1", name: "GLM 中转" }]);

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );

    // attach 并发拉 run 快照（whoLine 数据源）
    await waitFor(() => {
      expect(mocks.listSessionRuns).toHaveBeenCalledWith("s-1");
    });

    const who = await screen.findByLabelText("轮次配置快照");
    expect(who).toHaveTextContent("📋 知识经理");
    // agentName 兜底链首取会话 config_snapshot.agent_name
    expect(who).toHaveTextContent("Claude Code");
    // llm_provider_id 对照供应商列表名
    expect(who).toHaveTextContent("☁ GLM 中转");

    // 历史 usage 回填：ctx-ring 累计含历史轮（无分母 → 直显累计值 1.5k）
    const ring = screen.getByTestId("ctx-ring");
    await waitFor(() => {
      expect(ring).toHaveTextContent("1.5k");
    });
  });

  it("快照缺键如实显示：无档案 / 无供应商 → 未指定 / 本机默认", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeHistoryLog("log-3", "r-9", "user_input", "第二条提问"),
      makeHistoryLog("log-4", "r-9", "stdout", "答复正文。"),
    ]);
    mocks.listSessionRuns.mockResolvedValue([
      makeRunItem({ id: "r-9", input_tokens: 0, output_tokens: 0 }),
    ]);

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );

    const who = await screen.findByLabelText("轮次配置快照");
    expect(who).toHaveTextContent("📋 未指定");
    expect(who).toHaveTextContent("☁ 本机默认");
  });

  it("runs 快照拉取失败 → whoLine 不注入、消息流照常渲染（容错零回归）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeHistoryLog("log-5", "r-1", "user_input", "提问内容"),
      makeHistoryLog("log-6", "r-1", "stdout", "答复内容。"),
    ]);
    mocks.listSessionRuns.mockRejectedValue(new Error("boom"));

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );

    await waitFor(() => {
      expect(screen.getByText("提问内容")).toBeTruthy();
    });
    expect(screen.queryByLabelText("轮次配置快照")).toBeNull();
  });

  it("用户消息气泡显示发送者+时间（ql-20260817-003：会话属主=我 / 他人=用户名）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeHistoryLog("log-7", "r-1", "user_input", "属主发言"),
      makeHistoryLog("log-8", "r-1", "stdout", "答复。"),
      makeHistoryLog("log-9", "r-2", "user_input", "他人发言"),
      makeHistoryLog("log-10", "r-2", "stdout", "答复2。"),
    ]);
    mocks.listSessionRuns.mockResolvedValue([
      makeRunItem({
        id: "r-1",
        user_id: "u-owner",
        sender_name: "WhaleFall",
        started_at: "2026-08-15T08:00:00Z",
      }),
      makeRunItem({
        id: "r-2",
        user_id: "u-other",
        sender_name: "张三",
        started_at: "2026-08-15T09:00:00Z",
      }),
    ]);

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );

    // 属主 → 「我」；他人 → 用户名；都带时间（今天=HH:mm，跨天=MM-DD HH:mm）
    const timePat = "(?:\\d{2}:\\d{2}|\\d{2}-\\d{2} \\d{2}:\\d{2})";
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`^我 · ${timePat}$`)),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(new RegExp(`^张三 · ${timePat}$`)),
    ).toBeInTheDocument();
  });
});
