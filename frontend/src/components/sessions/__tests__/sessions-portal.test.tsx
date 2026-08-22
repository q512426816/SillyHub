/**
 * SessionsPortal 单测（2026-08-22-workspace-sessions-portal task-08 / FR-07 /
 * D-003@v2 / D-004@v1；task-11 v3 返工改写 scope 断言）。
 *
 * 依据：
 *   - components/sessions/sessions-portal.tsx（task-01 共享门户实现）
 *   - design.md §4.F 用例枚举（三 scope 渲染 / scope 过滤参透传 / ?session=
 *     深链 / 创建绑定双传）、§4.A（scope 派生三处路由）、§4.B v3（scope
 *     复用全局端点 listAgentSessions 加过滤参，D-003@v2）、§4.D（?session=
 *     深链直达选中态）
 *   - tasks/task-08.md acceptance：对账双清单之一——退役 4 用例语义落点
 *     （scope 过滤 / 创建绑定 / ?session= 深链在本文件；ended 恢复语义在
 *     sessions 页 page.test.tsx 既有 reopen 断言）
 *
 * 覆盖（design §4.F）：
 *   1. 三 scope 渲染（D-003@v2）：全局无参（listAgentSessions({limit:50})）/
 *      workspace（listAgentSessions({limit:50, workspace_id})）/
 *      change（listAgentSessions({limit:50, workspace_id, change_id})，
 *      change 隐含 workspace 双传）+ 标题范围后缀（D-001@v1）；
 *      v2 两 scope 端点零调用
 *   2. scope 过滤参透传即端点职责（D-003@v2，取代 v2 客户端仅本人过滤）：
 *      mock 返回什么渲染什么（他人会话不再客户端剔除），断言落点在
 *      listAgentSessions 过滤参（owner/scope 过滤都在端点 SQL 层）
 *   3. ?session= 深链（D-004@v1）：有效 id → getAgentSession 200 → 初始
 *      选中面板渲染；无参 / 无效 id → 静默停留新建表单态
 *   4. 绑定透传（task-05 契约经门户派生）：workspace scope createSession
 *      参数含 workspace_id；change scope change_id + workspace_id 双传
 *
 * mock 策略（对齐 sessions 页 page.test.tsx 既有结构——同一渲染树）：
 *   - @/lib/daemon 整模块 mock（列表 API + 面板/表单/控件条消费函数，
 *     streamSession 不建真实 EventSource；listWorkspaceAgentSessions /
 *     listChangeSessions 仅剩 D-003@v2 零调用断言用途）
 *   - next/navigation mock（useSearchParams——深链用例可控 ?session=，
 *     对齐 runtimes/__tests__/page.test.tsx 惯例）
 *   - @/lib/use-daemon-machines、@/lib/agent-profiles（hook 部分）、
 *     @/lib/api/llm-providers、@/lib/workspaces、@/lib/workspace-binding mock
 *   - jsdom 虚拟滚动视口桩（与 session-list-panel.test.tsx 同款）
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

// scope 类型复用 task-04 提供的判别联合（不重复定义）
import { SessionsPortal } from "@/components/sessions/sessions-portal";
import type { SessionListScope } from "@/components/sessions/session-list-panel";
import { ApiError } from "@/lib/api";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // 列表 API（D-003@v2：数据源统一 listAgentSessions；两 scope 端点仅剩
  // 零调用断言用途）
  listAgentSessions: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
  // 面板/表单消费（对齐 page.test.tsx）
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
  deleteAgentSession: vi.fn(),
  machinesHook: vi.fn(),
  profilesHook: vi.fn(),
  listProviders: vi.fn(),
  getProviderQuota: vi.fn(),
  listWorkspaces: vi.fn(),
  fetchMyBindings: vi.fn(),
  // D-004@v1 深链：useSearchParams 返回值（每用例可改写）
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/daemon", () => ({
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "" },
    codex: { label: "Codex", icon: "🟢", color: "" },
  },
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  listWorkspaceAgentSessions: (...args: unknown[]) =>
    mocks.listWorkspaceAgentSessions(...args),
  listChangeSessions: (...args: unknown[]) => mocks.listChangeSessions(...args),
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
  deleteAgentSession: (...args: unknown[]) => mocks.deleteAgentSession(...args),
}));

// task-08（D-004@v1）：门户挂载时 useSearchParams 解析 ?session=——jsdom 无
// app router 上下文时返回 null（sessions-portal.tsx:78 即原 18 红根因），
// 按 runtimes/__tests__/page.test.tsx 惯例 mock 成可控 searchParams。
vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
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

// SessionListPanel chips 工作区名解析 + WorkspaceSessionPicker 数据源。
vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBindings: (...args: unknown[]) => mocks.fetchMyBindings(...args),
}));

// 对齐 page.test.tsx：useNotify 改 mock 捕获（jsdom 无 antd App 上下文）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return {
    ...actual,
    useNotify: () => ({
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

// 对齐 page.test.tsx：MarkdownText 用 next/dynamic ssr:false，jsdom 同步
// render 得 null——mock 成纯文本渲染。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
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
    user_id: "u-me",
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

const WORKSPACE_SCOPE: SessionListScope = {
  kind: "workspace",
  workspaceId: "ws-1",
};
const CHANGE_SCOPE: SessionListScope = {
  kind: "change",
  workspaceId: "ws-1",
  changeId: "chg-1",
};

function renderPortal(scope?: SessionListScope) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionsPortal scope={scope} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
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
  mocks.listWorkspaces.mockResolvedValue({ items: [], total: 0 });
  mocks.fetchMyBindings.mockResolvedValue([]);
  mocks.listAgentSessions.mockResolvedValue({
    items: [makeSession()],
    total: 1,
    limit: 50,
    offset: 0,
  });
  mocks.listWorkspaceAgentSessions.mockResolvedValue([]);
  mocks.listChangeSessions.mockResolvedValue([]);
  mocks.getAgentSession.mockResolvedValue(makeSession());
  mocks.getAgentSessionLogs.mockResolvedValue([]);
  mocks.createSession.mockResolvedValue({
    session_id: "s-new",
    run_id: "r-new",
    lease_id: "l-new",
    status: "pending",
    stream_url: "/stream",
  });
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

// ── 1. 三 scope 渲染（design §4.A / §4.E / D-001@v1 / D-003@v2） ──────────

describe("SessionsPortal 三 scope 渲染", () => {
  it("全局（无参 scope）：列表走 listAgentSessions（limit 路由断言），标题无范围后缀，scope 两端点零调用", async () => {
    renderPortal();

    expect(screen.getByRole("heading", { name: "智能体会话" })).toBeTruthy();
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({ limit: 50 });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 全局列表条目照常渲染（门户默认态可交互）
    expect(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    ).toBeTruthy();
  });

  it("workspace scope：列表走 listAgentSessions({limit, workspace_id})，标题「智能体会话 · 工作区」，NewSessionForm 锁定工作区", async () => {
    renderPortal(WORKSPACE_SCOPE);

    expect(
      screen.getByRole("heading", { name: "智能体会话 · 工作区" }),
    ).toBeTruthy();
    // D-003@v2：scope 复用全局端点，仅多传 workspace_id 过滤参
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 50,
        workspace_id: "ws-1",
      });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 绑定透传（task-05 契约经门户派生）：ql-20260822-010 聊天优先——折叠态
    // chips 常显锁定标识；展开「修改配置」后 ⓪ 区锁定提示条替代 picker。
    expect(
      await screen.findByRole("button", { name: "🔒 工作区已锁定" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修改配置" }));
    expect(
      await screen.findByText(/已锁定绑定工作区，不可更换/),
    ).toBeTruthy();
    expect(screen.getByText(/已锁定 · 会话将在绑定工作区的项目目录中运行/)).toBeTruthy();
  });

  it("change scope：列表走 listAgentSessions({limit, workspace_id, change_id} 双传)，标题「智能体会话 · 变更」，其余两端点零调用", async () => {
    renderPortal(CHANGE_SCOPE);

    expect(
      screen.getByRole("heading", { name: "智能体会话 · 变更" }),
    ).toBeTruthy();
    // D-003@v2：change 级隐含 workspace——两过滤参同时下发
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 50,
        workspace_id: "ws-1",
        change_id: "chg-1",
      });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // change 级隐含 workspace 双传（task-05）：⓪ 区同样锁定（折叠态 chips +
    // 展开后提示条，ql-20260822-010 聊天优先版式）
    expect(
      await screen.findByRole("button", { name: "🔒 工作区已锁定" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修改配置" }));
    expect(
      await screen.findByText(/已锁定绑定工作区，不可更换/),
    ).toBeTruthy();
  });
});

// ── 2. scope 过滤参透传（D-003@v2；v2 客户端仅本人过滤已删，语义落点改造） ──

describe("SessionsPortal scope 过滤参透传（D-003@v2：过滤是端点职责）", () => {
  /** 端点过滤后返回固件：本人 + 他人两条（AgentSessionRead 全字段形状）。 */
  function endpointFilteredItems() {
    return [
      makeSession({ id: "s-mine", title: "我的会话", user_id: "u-me" }),
      makeSession({ id: "s-other", title: "同事的会话", user_id: "u-other" }),
    ];
  }

  it("workspace scope：透传 workspace_id 即完成过滤（端点 SQL 层职责）；mock 返回什么渲染什么（零客户端剔除）", async () => {
    mocks.listAgentSessions.mockResolvedValue({
      items: endpointFilteredItems(),
      total: 2,
      limit: 50,
      offset: 0,
    });
    renderPortal(WORKSPACE_SCOPE);

    // 过滤参断言 = v2「仅本人过滤」语义的 v3 落点：owner/scope 过滤都在端点
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 50,
        workspace_id: "ws-1",
      });
    });
    // 客户端零过滤：他人会话（user_id ≠ 当前用户）照常渲染，总数 = 端点 total
    expect(
      await screen.findByRole("button", { name: "会话 我的会话" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeTruthy();
    expect(screen.getByText("共 2 个")).toBeTruthy();
  });

  it("change scope：workspace_id + change_id 双传（端点过滤）；change 级同样零客户端过滤", async () => {
    mocks.listAgentSessions.mockResolvedValue({
      items: endpointFilteredItems(),
      total: 2,
      limit: 50,
      offset: 0,
    });
    renderPortal(CHANGE_SCOPE);

    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 50,
        workspace_id: "ws-1",
        change_id: "chg-1",
      });
    });
    expect(
      await screen.findByRole("button", { name: "会话 我的会话" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeTruthy();
    expect(screen.getByText("共 2 个")).toBeTruthy();
  });
});

// ── 3. ?session= 深链（D-004@v1；退役 workspace-session-section 恢复点语义落点） ──

describe("SessionsPortal ?session= 深链（D-004@v1）", () => {
  it("有效 id：getAgentSession 200 → 初始选中面板渲染（不经列表点击直达选中态）", async () => {
    mocks.searchParams = new URLSearchParams("session=s-deep");
    mocks.getAgentSession.mockResolvedValue(
      makeSession({ id: "s-deep", title: "深链直达的会话" }),
    );
    renderPortal();

    await waitFor(() => {
      expect(mocks.getAgentSession).toHaveBeenCalledWith("s-deep");
    });
    // 初始 selectedSessionId 落定 → 右侧直接是会话面板，新建表单不出现
    await waitFor(() => {
      expect(screen.getByLabelText("会话面板")).toBeTruthy();
    });
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
    // 页头出现「新建会话」入口（选中态 actions）
    expect(screen.getByRole("button", { name: "新建会话" })).toBeTruthy();
  });

  it("无参：不发起 getAgentSession 深链验证，静默停留新建表单态", async () => {
    renderPortal();

    // 微任务 flush 后仍停留新建态（深链 effect 早返回）
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getAgentSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("新建会话表单")).toBeTruthy();
    expect(screen.queryByLabelText("会话面板")).toBeNull();
  });

  it("无效 id（getAgentSession 404）：静默忽略，停留新建表单态（不抛错不出错误条）", async () => {
    mocks.searchParams = new URLSearchParams("session=s-404");
    mocks.getAgentSession.mockRejectedValueOnce(
      new ApiError(404, {
        code: "HTTP_404_DAEMON_SESSION_NOT_FOUND",
        message: "session not found or not yours",
        request_id: "req-1",
        details: null,
      }),
    );
    renderPortal();

    await waitFor(() => {
      expect(mocks.getAgentSession).toHaveBeenCalledWith("s-404");
    });
    // catch 静默（迁移旧 workspace-session-section :106-108 语义）
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("新建会话表单")).toBeTruthy();
    expect(screen.queryByLabelText("会话面板")).toBeNull();
  });
});

// ── 4. 绑定透传：创建参数（task-05 契约经门户 scope 派生；退役两 section 绑定语义落点） ──

describe("SessionsPortal 创建绑定透传", () => {
  /** 填消息并点「开始会话」（默认机器自动回退 rt-1 claude）。 */
  async function submitForm(prompt: string) {
    const input = await screen.findByLabelText("会话消息输入");
    fireEvent.change(input, { target: { value: prompt } });
    fireEvent.click(screen.getByRole("button", { name: "开始会话" }));
    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledTimes(1);
    });
  }

  it("workspace scope：createSession 参数含 workspace_id（绑定值），不带 change_id", async () => {
    renderPortal(WORKSPACE_SCOPE);
    await submitForm("在工作区里开个会话");

    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-1",
      prompt: "在工作区里开个会话",
      manual_approval: true,
      ask_user_only: true,
      workspace_id: "ws-1",
    });
  });

  it("change scope：createSession 参数 change_id + workspace_id 双传（change 级隐含 workspace）", async () => {
    renderPortal(CHANGE_SCOPE);
    await submitForm("在变更里开个会话");

    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-1",
      prompt: "在变更里开个会话",
      manual_approval: true,
      ask_user_only: true,
      workspace_id: "ws-1",
      change_id: "chg-1",
    });
  });
});
