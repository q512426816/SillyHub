/**
 * SessionsPortal 单测（2026-08-22-workspace-sessions-portal task-08 / FR-07 /
 * D-003@v2 / D-004@v1；task-11 v3 返工改写 scope 断言；2026-08-23-
 * sessions-workspace-hub task-06 双态接线改写）。
 *
 * 依据：
 *   - components/sessions/sessions-portal.tsx（task-01 共享门户 + task-06 双态
 *     接线与上下文解析实现）
 *   - design.md §2 FR-03/FR-04/FR-06、§7 接口定义（SessionPreContext）、§9
 *     兼容策略（深链无效落空门户态）、§4.F 用例枚举（三 scope 渲染 / scope
 *     过滤参透传 / ?session= 深链）、§11 D-107（全部态两步浮层）
 *   - tasks/task-06.md acceptance：组头＋→浮层→预会话；首句创建成功切真会话+
 *     列表刷新；不发言切走零残留；?session= 深链/无效静默；workspace 预展开
 *     传参；页头「新建会话」按钮移除（X-12）；三 scope 标题与数据源不回归
 *
 * 覆盖：
 *   1. 三 scope 渲染（D-003@v2 / D-001@v1）：标题后缀 + 端点过滤参 + 右侧
 *      空门户态（NewSessionForm 渲染分支 task-06 起替换，X-12 / D-109——原
 *      锁定表单断言语义迁移归 task-07 change 入口用例）；workspace scope 经
 *      defaultExpandedWorkspaceId 预展开传参（FR-06）
 *   2. scope 过滤参透传即端点职责（D-003@v2，task-11 v3 语义原样保留）
 *   3. ?session= 深链（D-004@v1）：有效直达选中；无参/无效静默落空门户态
 *     （原落新建表单态，design §9）；页头「新建会话」按钮移除断言（X-12）
 *   4. 组头＋→两步浮层→预会话（FR-03/FR-04/D-107）：浮层选完合成 preContext
 *      渲染 SessionPanel sessionId=null（上下文行=分组+机器+智能体）；浮层取消
 *      零影响；首句创建成功→切真会话（key 重挂载 detailQuery 接管）+ invalidate
 *      列表；不发言切走零残留（删除选中会话后落空门户态，不回吐预会话）
 *   5. workspace 组＋绑定继承：preContext 带组 workspaceId → 首句 createSession
 *      带 workspace_id（原 NewSessionForm bindWorkspaceId 语义由 preContext
 *      继承；change 双传用例 task-07 补齐——change scope 平铺列表无组头＋，
 *      入口在页头「新建会话（本变更）」）
 *   6. resolveDefaultMachineId 迁移用例（D-005 三级回退，语义照抄 new-session-
 *      form.test D-005 三用例；源文件 task-07 删，此处为新家）
 *
 * mock 策略（对齐 sessions 页 page.test.tsx 既有结构——同一渲染树）：
 *   - @/lib/daemon 整模块 mock（列表 API + 面板/表单/控件条消费函数，
 *     streamSession 不建真实 EventSource；listWorkspaceAgentSessions /
 *     listChangeSessions 仅剩 D-003@v2 零调用断言用途）
 *   - next/navigation mock（useSearchParams——深链用例可控 ?session=）
 *   - @/lib/use-daemon-machines、@/lib/agent-profiles（hook 部分）、
 *     @/lib/api/llm-providers、@/lib/workspaces、@/lib/workspace-binding mock
 *   - session-list-panel 经 importActual 包一层 props 捕获（defaultExpanded-
 *     WorkspaceId 受控传参断言——workspace scope 单组形态下 DOM 无差异，只能
 *     从 props 层断言；其余行为走真实组件）
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

// scope 类型复用 task-04 提供的判别联合（不重复定义）
import {
  SessionsPortal,
  NEW_SESSION_MACHINE_LS_KEY,
  resolveDefaultMachineId,
} from "@/components/sessions/sessions-portal";
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
  // task-07（D-106）：预会话上下文行变更名解析（session-panel getChange）。
  getChange: vi.fn(),
  // D-004@v1 深链：useSearchParams 返回值（每用例可改写）
  searchParams: new URLSearchParams(),
  // task-06：SessionListPanel props 捕获（defaultExpandedWorkspaceId 断言用）
  lastListPanelProps: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/daemon", () => ({
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "" },
    codex: { label: "Codex", icon: "🟢", color: "" },
  },
  // task-05：SessionListPanel 树形态消费的一次拉取上限常量。
  AGENT_SESSIONS_TREE_FETCH_LIMIT: 500,
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

// task-07（D-106）：session-panel 上下文行变更名解析数据源。
vi.mock("@/lib/changes", () => ({
  getChange: (...args: unknown[]) => mocks.getChange(...args),
}));

// task-06：SessionListPanel 包一层 props 捕获（渲染真实组件零行为差异）——
// defaultExpandedWorkspaceId 在 workspace scope 单组形态下无 DOM 差异，传参
// 断言只能落在 props 层（FR-06 workspace 入口预展开）。
vi.mock("@/components/sessions/session-list-panel", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/sessions/session-list-panel")
  >("@/components/sessions/session-list-panel");
  const ActualSessionListPanel = actual.SessionListPanel;
  return {
    ...actual,
    SessionListPanel: (props: Parameters<typeof ActualSessionListPanel>[0]) => {
      mocks.lastListPanelProps = props as unknown as Record<string, unknown>;
      return <ActualSessionListPanel {...props} />;
    },
  };
});

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

/**
 * task-06：组头「＋」→ 两步浮层（machine-1 → Claude Code 默认）→ 预会话态。
 * 返回预会话面板出现的 waitFor promise。
 */
async function enterPreSession(groupNewLabel: string) {
  // 组头随树渲染到达（查询 settle 后）——findByRole 等待
  fireEvent.click(
    await screen.findByRole("button", { name: groupNewLabel }),
  );
  // ① 机器（仅在线；默认 fixtures m-1/m-2 均在线）
  fireEvent.click(
    await screen.findByRole("button", { name: "选择机器 machine-1" }),
  );
  // ② 智能体（选完立即 onPick 关闭）
  fireEvent.click(
    await screen.findByRole("button", { name: "选择智能体 Claude Code" }),
  );
  await waitFor(() =>
    expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull(),
  );
  return screen.findByTestId("session-pre-session-panel");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
  mocks.lastListPanelProps = null;
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
  // task-07（D-106）：变更名解析（title 优先，change_key 回退——见下方用例）。
  mocks.getChange.mockResolvedValue({
    id: "chg-1",
    workspace_id: "ws-1",
    change_key: "2026-08-23-sessions-workspace-hub",
    title: "会话工作区中枢",
    status: "execute",
    location: "remote",
    path: ".sillyspec/changes/2026-08-23-sessions-workspace-hub",
    affected_components: ["frontend"],
    change_type: null,
    owner_id: "u-me",
  });
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
  it("全局（无参 scope）：列表走 listAgentSessions（limit 路由断言），标题无范围后缀，scope 两端点零调用，空门户态渲染", async () => {
    renderPortal();

    expect(screen.getByRole("heading", { name: "智能体会话" })).toBeTruthy();
    await waitFor(() => {
      // task-05（2026-08-23-sessions-workspace-hub）：全局形态工作区树一次
      // 拉取 limit=500（D-103），原 limit=50 断言随形态迁移。
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({ limit: 500 });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 全局列表条目照常渲染（门户默认态可交互）
    expect(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    ).toBeTruthy();
    // task-06：未选中/无 preContext → 空门户态（NewSessionForm 分支已替换）
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
    // task-07：非 change scope 无页头预会话按钮（X-12：入口收敛组头「＋」）
    expect(
      screen.queryByRole("button", { name: "新建会话（本变更）" }),
    ).toBeNull();
    // 全局 scope 不传预展开（FR-06 仅 workspace 入口）
    expect(mocks.lastListPanelProps?.defaultExpandedWorkspaceId).toBeUndefined();
  });

  it("workspace scope：列表走 listAgentSessions({limit, workspace_id})，标题「智能体会话 · 工作区」，空门户态 + defaultExpandedWorkspaceId 预展开传参（FR-06）", async () => {
    renderPortal(WORKSPACE_SCOPE);

    expect(
      screen.getByRole("heading", { name: "智能体会话 · 工作区" }),
    ).toBeTruthy();
    // D-003@v2：scope 复用全局端点，仅多传 workspace_id 过滤参；
    // task-05：workspace scope 树形态同走一次拉取 limit=500
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
        workspace_id: "ws-1",
      });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // task-06：右侧空门户态（原 NewSessionForm 锁定表单断言已随分支替换退役，
    // workspace 绑定语义由 preContext 继承——见 describe 5）
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
    // FR-06 workspace 入口预展开：scope.workspaceId 传受控展开 prop
    expect(mocks.lastListPanelProps?.defaultExpandedWorkspaceId).toBe("ws-1");
    // 组头「＋」已接线（组名解析失败兜底「当前工作区」；随树渲染到达）
    expect(
      await screen.findByRole("button", { name: "在 当前工作区 新建会话" }),
    ).toBeTruthy();
  });

  it("change scope：列表走 listAgentSessions({limit:500, workspace_id, change_id} 双传)，标题「智能体会话 · 变更」，树单组＋预展开（ql-20260823-003 统一树形态），页头按钮已移除", async () => {
    renderPortal(CHANGE_SCOPE);

    expect(
      screen.getByRole("heading", { name: "智能体会话 · 变更" }),
    ).toBeTruthy();
    // D-003@v2：change 级隐含 workspace——两过滤参同时下发（树一次拉取 limit 500）
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
        workspace_id: "ws-1",
        change_id: "chg-1",
      });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 右侧空门户态；树单组组头「＋」（新建入口，经门户双传 change 上下文）
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "在 当前工作区 新建会话" }),
    ).toBeTruthy();
    // ql-20260823-003：页头按钮移除（D-106 修订，入口收敛组头「＋」）
    expect(
      screen.queryByRole("button", { name: "新建会话（本变更）" }),
    ).toBeNull();
    // change 同 workspace 入口：预展开该组
    expect(mocks.lastListPanelProps?.defaultExpandedWorkspaceId).toBe("ws-1");
  });
});

// ── 2. scope 过滤参透传（D-003@v2；v2 客户端仅本人过滤已删，语义落点改造） ──

describe("SessionsPortal scope 过滤参透传（D-003@v2：过滤是端点职责）", () => {
  /** 端点过滤后返回固件：本人 + 他人两条（AgentSessionRead 全字段形状；
   * task-05 树形态按 workspace_id 分组，端点过滤后条目携带该 workspace_id）。 */
  function endpointFilteredItems() {
    return [
      makeSession({ id: "s-mine", title: "我的会话", user_id: "u-me", workspace_id: "ws-1" }),
      makeSession({ id: "s-other", title: "同事的会话", user_id: "u-other", workspace_id: "ws-1" }),
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
    //（task-05：limit 随树形态一次拉取改 500）
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
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
        limit: 500,
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
  it("有效 id：getAgentSession 200 → 初始选中面板渲染（不经列表点击直达选中态）；页头「新建会话」按钮已移除（X-12）", async () => {
    mocks.searchParams = new URLSearchParams("session=s-deep");
    mocks.getAgentSession.mockResolvedValue(
      makeSession({ id: "s-deep", title: "深链直达的会话" }),
    );
    renderPortal();

    await waitFor(() => {
      expect(mocks.getAgentSession).toHaveBeenCalledWith("s-deep");
    });
    // 初始 selectedSessionId 落定 → 右侧直接是会话面板，空门户态不出现
    await waitFor(() => {
      expect(screen.getByLabelText("会话面板")).toBeTruthy();
    });
    expect(screen.queryByLabelText("门户空态")).toBeNull();
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
    // X-12：页头「新建会话」按钮移除（新建入口收敛到组头「＋」）
    expect(screen.queryByRole("button", { name: "新建会话" })).toBeNull();
  });

  it("无参：不发起 getAgentSession 深链验证，静默停留空门户态", async () => {
    renderPortal();

    // 微任务 flush 后仍停留空门户态（深链 effect 早返回）
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getAgentSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByLabelText("会话面板")).toBeNull();
  });

  it("无效 id（getAgentSession 404）：静默忽略，落空门户态（不抛错不出错误条；design §9）", async () => {
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
    // catch 静默（迁移旧 workspace-session-section :106-108 语义；原落新建
    // 表单态 → task-06 起落空门户态）
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByLabelText("会话面板")).toBeNull();
  });
});

// ── 4. 组头＋→两步浮层→预会话（FR-03/FR-04/D-107，task-06 核心接线） ───────

// ── 3.5 ?new=1 直达新建（ql-20260823-005：外部入口「发起团队」免手动新建） ──

describe("SessionsPortal ?new=1 直达新建（ql-20260823-005）", () => {
  it("默认机器解析命中（localStorage 上次选择，D-005 第一级）→ 跳过浮层直接预会话态，上下文行=机器+默认 Claude；首句未发零残留", async () => {
    window.localStorage.setItem(NEW_SESSION_MACHINE_LS_KEY, "m-1");
    mocks.searchParams = new URLSearchParams("new=1");
    renderPortal();

    // 自动进预会话（不经组头＋/浮层）
    await waitFor(() => {
      expect(screen.getByTestId("session-pre-session-panel")).toBeTruthy();
    });
    expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull();
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("machine-1");
    expect(ctx.textContent).toContain("Claude Code");
    expect(ctx.textContent).toContain("不指定（非工作区）");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("解析不命中（无在线机器）→ 自动弹两步浮层兜底（浮层空态引导），不落空门户态让用户再手动点", async () => {
    mocks.machinesHook.mockReturnValue({
      items: [
        makeMachine({ id: "m-off", hostname: "machine-off", status: "offline" }),
      ],
      sessions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mocks.searchParams = new URLSearchParams("new=1");
    renderPortal();

    await waitFor(() => {
      expect(screen.getByTestId("pre-session-picker-mask")).toBeTruthy();
    });
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
  });

  it("?new=1 与 ?session= 同传 → 深链选中优先（getAgentSession 验证直达），不自动新建", async () => {
    mocks.searchParams = new URLSearchParams("new=1&session=s-deep");
    mocks.getAgentSession.mockResolvedValue(
      makeSession({ id: "s-deep", title: "深链直达的会话" }),
    );
    renderPortal();

    await waitFor(() => {
      expect(screen.getByLabelText("会话面板")).toBeTruthy();
    });
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
    expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull();
  });

  it("workspace scope + ?new=1 → preContext 绑定 scope.workspaceId，首句 createSession 带 workspace_id", async () => {
    window.localStorage.setItem(NEW_SESSION_MACHINE_LS_KEY, "m-1");
    mocks.searchParams = new URLSearchParams("new=1");
    renderPortal(WORKSPACE_SCOPE);

    await waitFor(() => {
      expect(screen.getByTestId("session-pre-session-panel")).toBeTruthy();
    });
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "工作区里开个会话" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_id: "rt-1",
        prompt: "工作区里开个会话",
        workspace_id: "ws-1",
      }),
    );
  });
});

describe("SessionsPortal 组头＋→浮层→预会话（FR-03/FR-04）", () => {
  it("组头＋ → 两步浮层（机器→智能体）→ onPick 合成 preContext：渲染 SessionPanel sessionId=null 预会话态，上下文行=分组+机器+智能体", async () => {
    renderPortal();
    await enterPreSession("在 非工作区 新建会话");

    // 预会话面板（task-03 同构空态）；真会话面板不出现
    expect(screen.getByTestId("session-pre-session-panel")).toBeTruthy();
    expect(mocks.createSession).not.toHaveBeenCalled(); // 未发首句不创建
    // 上下文行（D-104 锁定）：工作区=非工作区分组（null）+ 机器 + 智能体
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("不指定（非工作区）");
    expect(ctx.textContent).toContain("machine-1");
    expect(ctx.textContent).toContain("Claude Code");
    expect(ctx.textContent).toContain("上下文已锁定");
    // 空门户态消失
    expect(screen.queryByLabelText("门户空态")).toBeNull();
  });

  it("浮层取消：仅关闭浮层，右侧当前态零影响（不合成 preContext）", async () => {
    renderPortal();
    expect(screen.getByLabelText("门户空态")).toBeTruthy();

    fireEvent.click(
      await screen.findByRole("button", { name: "在 非工作区 新建会话" }),
    );
    expect(screen.getByTestId("pre-session-picker-mask")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull(),
    );
    // 仍是空门户态（未选完不合成上下文）
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
  });

  it("首句创建成功 → 切真会话（key 重挂载 detailQuery 以新 id 接管）+ invalidate 列表 + 预会话态清除", async () => {
    renderPortal();
    await enterPreSession("在 非工作区 新建会话");
    const listCallsBefore = mocks.listAgentSessions.mock.calls.length;

    // 预会话首句发送（task-03 契约：面板内部 createSession）
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "第一句话开个会话" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    // 非工作区分组（workspaceId null）→ 请求体不带 workspace_id/change_id
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-1",
      prompt: "第一句话开个会话",
      manual_approval: true,
      ask_user_only: true,
    });

    // onPreSessionCreated → setSelectedSessionId 切真会话（key 重挂载）：
    // 预会话面板消失 + detailQuery 以新 session_id 接管
    await waitFor(() =>
      expect(screen.queryByTestId("session-pre-session-panel")).toBeNull(),
    );
    await waitFor(() =>
      expect(mocks.getAgentSession).toHaveBeenCalledWith("s-new"),
    );
    expect(screen.getByLabelText("会话面板")).toBeTruthy();
    // invalidate ["agentSessions"] 前缀命中树查询 → 列表重新拉取（新会话
    // 落对应分组顶部）
    await waitFor(() =>
      expect(mocks.listAgentSessions.mock.calls.length).toBeGreaterThan(
        listCallsBefore,
      ),
    );
  });

  it("不发言切走零残留：预会话态选中列表会话 → preContext 清除（删除选中会话后落空门户态，不回吐预会话）", async () => {
    renderPortal();
    await enterPreSession("在 非工作区 新建会话");

    // 切走：点列表既有会话 → 真会话面板接管，预会话面板消失
    fireEvent.click(
      screen.getByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("session-pre-session-panel")).toBeNull(),
    );
    expect(screen.getByLabelText("会话面板")).toBeTruthy();

    // 删除当前选中会话 → 选中清空；若切走时 preContext 未清会回吐预会话态
    //（本用例即该回归的守护）
    fireEvent.click(
      screen.getByRole("button", { name: "删除 整理这周的会议纪要" }),
    );
    const okBtn = await waitFor(() => {
      // Modal.confirm 确认按钮（okText「删除」两字，antd 自动插空格影响可
      // 访问名，经危险按钮类锚定——session-list-panel.test 同款）
      const btn = document.querySelector(
        ".ant-modal-confirm-btns .ant-btn-primary",
      ) as HTMLElement | null;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
    fireEvent.click(okBtn);
    await waitFor(() => expect(screen.getByLabelText("门户空态")).toBeTruthy());
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
    // 首句未发 → 零服务端实体（createSession 从未调用）
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

// ── ql-20260823-001：筛选态直带链（D-107 优先级第一段补齐） ───────────────

describe("SessionsPortal 筛选态直带上下文（ql-20260823-001）", () => {
  it("两层筛选已选（机器+智能体）点组头「＋」→ 跳过浮层直接预会话，上下文行=筛选机器+引擎", async () => {
    renderPortal();
    // 树内两层筛选（默认 mock：m-1 machine-1 rt-1 claude 在线）
    fireEvent.click(
      await screen.findByRole("button", { name: "机器tab machine-1" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "智能体tab ⚡ Claude Code" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "在 非工作区 新建会话" }),
    );

    // 浮层不出现（免重复选择）——直进预会话态
    await waitFor(() =>
      expect(screen.getByTestId("session-pre-session-panel")).toBeTruthy(),
    );
    expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull();
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("machine-1");
    expect(ctx.textContent).toContain("Claude Code");
    expect(ctx.textContent).toContain("不指定（非工作区）");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("仅选机器未选智能体（或未筛选）→ 仍走两步浮层（上下文不完整不直带）", async () => {
    renderPortal();
    fireEvent.click(
      await screen.findByRole("button", { name: "机器tab machine-1" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "在 非工作区 新建会话" }),
    );
    // 智能体层未选具体值 → 浮层兜底
    expect(screen.getByTestId("pre-session-picker-mask")).toBeTruthy();
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
  });

  it("筛选的引擎无在线 runtime（如 Codex 离线）→ 回退浮层（不直带失效上下文）", async () => {
    mocks.machinesHook.mockReturnValue({
      items: [
        makeMachine({ id: "m-2", hostname: "machine-2", runtimes: [makeRuntime({ id: "rt-2", provider: "codex", status: "offline" })] }),
      ],
      sessions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPortal();
    fireEvent.click(
      await screen.findByRole("button", { name: "机器tab machine-2" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "智能体tab ◎ Codex" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "在 非工作区 新建会话" }),
    );
    // 该引擎无在线 runtime → 回退浮层（浮层第一步仅列在线机器）
    expect(screen.getByTestId("pre-session-picker-mask")).toBeTruthy();
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
  });
});

// ── 5. workspace 组＋绑定继承（原 NewSessionForm bindWorkspaceId 语义由 preContext 继承） ──

describe("SessionsPortal workspace 组＋创建绑定（preContext 继承）", () => {
  it("workspace 组＋ → preContext 带组 workspaceId → 首句 createSession 带 workspace_id（绑定值），不带 change_id", async () => {
    renderPortal(WORKSPACE_SCOPE);
    await enterPreSession("在 当前工作区 新建会话");

    // 上下文行工作区维度 = 组所在工作区（workspacesQuery 未命中 → 兜底文案）
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("未命名工作区");

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "在工作区里开个会话" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-1",
      prompt: "在工作区里开个会话",
      manual_approval: true,
      ask_user_only: true,
      workspace_id: "ws-1",
    });
  });

  // task-07：change 双传（change_id + workspace_id，X-13）用例——原经
  // NewSessionForm bindChangeId 断言的语义由本用例（门户 change 入口接线）与
  // session-panel-pre-session.test「X-13 语义」用例（面板参数展开层）共同承接。
  it("change 入口（X-13）：树组头「＋」→ 同一浮层 → preContext 双传；上下文行加显变更名（D-106）；首句 createSession change_id+workspace_id 双传（ql-20260823-003 起入口=组头＋）", async () => {
    renderPortal(CHANGE_SCOPE);

    // change scope 树单组组头「＋」（ql-20260823-003，D-106 修订）
    fireEvent.click(
      await screen.findByRole("button", { name: "在 当前工作区 新建会话" }),
    );
    // 同一两步浮层（①机器 ②智能体）
    fireEvent.click(
      await screen.findByRole("button", { name: "选择机器 machine-1" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "选择智能体 Claude Code" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull(),
    );
    expect(screen.getByTestId("session-pre-session-panel")).toBeTruthy();

    // 上下文行（D-106 加显变更名 + 工作区 + 机器 + 智能体，title 优先）
    await waitFor(() => {
      expect(mocks.getChange).toHaveBeenCalledWith("ws-1", "chg-1");
    });
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("会话工作区中枢");
    expect(ctx.textContent).toContain("未命名工作区"); // listWorkspaces 空 → 兜底
    expect(ctx.textContent).toContain("machine-1");
    expect(ctx.textContent).toContain("Claude Code");

    // 首句发送 → createSession 双传（X-13：change 级隐含 workspace）
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "在变更下开个会话" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-1",
      prompt: "在变更下开个会话",
      manual_approval: true,
      ask_user_only: true,
      workspace_id: "ws-1",
      change_id: "chg-1",
    });
  });

  it("change 入口 title 为 null → 变更名回退 change_key（D-106 空值链）", async () => {
    mocks.getChange.mockResolvedValue({
      id: "chg-1",
      workspace_id: "ws-1",
      change_key: "2026-08-23-sessions-workspace-hub",
      title: null,
      status: "execute",
      location: "remote",
      path: ".sillyspec/changes/2026-08-23-sessions-workspace-hub",
      affected_components: [],
      change_type: null,
      owner_id: null,
    });
    renderPortal(CHANGE_SCOPE);
    fireEvent.click(
      await screen.findByRole("button", { name: "在 当前工作区 新建会话" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "选择机器 machine-1" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "选择智能体 Claude Code" }),
    );

    const ctx = await screen.findByTestId("pre-session-context");
    await waitFor(() => {
      expect(ctx.textContent).toContain("2026-08-23-sessions-workspace-hub");
    });
  });
});

// ── 6. resolveDefaultMachineId 迁移（D-005 三级回退；task-06 自 new-session-form.tsx 迁入） ──

describe("SessionsPortal resolveDefaultMachineId 迁移（D-005 三级回退）", () => {
  it("第一级：localStorage 上次选择且在线 → 直接命中（优先于最近会话/心跳）", () => {
    window.localStorage.setItem(NEW_SESSION_MACHINE_LS_KEY, "m-2");
    const machines = [
      makeMachine({
        id: "m-1",
        hostname: "machine-1",
        last_heartbeat_at: "2026-08-15T09:00:00Z",
        runtimes: [makeRuntime({ id: "rt-m1-claude" })],
      }),
      makeMachine({
        id: "m-2",
        hostname: "machine-2",
        last_heartbeat_at: "2026-08-15T07:00:00Z",
        runtimes: [makeRuntime({ id: "rt-m2-claude" })],
      }),
    ];
    // 最近会话指向 m-1，但 localStorage（m-2）优先级更高
    const sessions = [makeSession({ runtime_id: "rt-m1-claude" })];
    expect(resolveDefaultMachineId(machines, sessions)).toBe("m-2");
  });

  it("第二级：无 localStorage → 最近会话所在的在线机器（last_active_at 优先）", () => {
    const machines = [
      makeMachine({
        id: "m-1",
        hostname: "machine-1",
        last_heartbeat_at: "2026-08-15T09:00:00Z", // 心跳更新，但第三级才用
        runtimes: [makeRuntime({ id: "rt-m1-claude" })],
      }),
      makeMachine({
        id: "m-2",
        hostname: "machine-2",
        last_heartbeat_at: "2026-08-15T07:00:00Z",
        runtimes: [makeRuntime({ id: "rt-m2-claude" })],
      }),
    ];
    const sessions = [
      makeSession({
        id: "s-old",
        runtime_id: "rt-m1-claude",
        last_active_at: "2026-08-14T10:00:00Z",
      }),
      makeSession({
        id: "s-new",
        runtime_id: "rt-m2-claude",
        last_active_at: "2026-08-15T08:00:00Z", // 最近 → m-2
      }),
    ];
    expect(resolveDefaultMachineId(machines, sessions)).toBe("m-2");
  });

  it("第三级：无历史会话 → 最新心跳的在线机器；离线机器不参与回退", () => {
    const machines = [
      makeMachine({
        id: "m-off",
        hostname: "machine-offline",
        status: "offline",
        last_heartbeat_at: "2026-08-15T23:00:00Z", // 心跳最新但离线
        runtimes: [makeRuntime({ id: "rt-off" })],
      }),
      makeMachine({
        id: "m-a",
        hostname: "machine-a",
        last_heartbeat_at: "2026-08-15T08:00:00Z",
      }),
      makeMachine({
        id: "m-b",
        hostname: "machine-b",
        last_heartbeat_at: "2026-08-15T09:30:00Z", // 在线中最新心跳
      }),
    ];
    expect(resolveDefaultMachineId(machines, [])).toBe("m-b");
  });
});
