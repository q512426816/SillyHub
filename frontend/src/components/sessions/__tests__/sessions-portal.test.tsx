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
 *   7. 选中态 URL 同步（ql-20260824-001）
 *   8. 会话列表变更信号订阅（2026-08-24-sessions-live-updates task-06 /
 *      D-001 / D-006）：onEvent / onReconnected → invalidate ["agentSessions"]
 *      前缀命中树查询重拉 listAgentSessions；unmount → sub.close() 关订阅
 *
 * mock 策略（对齐 sessions 页 page.test.tsx 既有结构——同一渲染树）：
 *   - @/lib/daemon 整模块 mock（列表 API + 面板/表单/控件条消费函数，
 *     streamSession 不建真实 EventSource；subscribeAgentSessionsEvents
 *     （task-06）同 mock 捕获 opts——不建真实信号连接；listWorkspaceAgentSessions /
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
  GroupChatListItemRead,
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
  // task-07（2026-09-01-session-group-chat）：群聊分区数据源 + 建群提交 +
  // 向导步骤②邀请候选（成员列表）。
  listGroupChats: vi.fn(),
  createGroupChat: vi.fn(),
  listMembers: vi.fn(),
  // task-09：群视图挂载点成员面板数据源 + 成员操作（member-panel 经真实
  // 模块 import 消费；mock 工厂需同名导出防 undefined 调用）。
  getGroupChat: vi.fn(),
  updateGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  resetGroupMemberMemory: vi.fn(),
  // task-08（2026-09-01-session-group-chat）：群聊面板（GroupChatPanel 经真实
  // 模块 import 消费）——消息发送 / typing 上报 / 群流 SSE 订阅（不建真实
  // 连接；close/resync 句柄捕获供断言）。
  sendGroupMessage: vi.fn(),
  sendGroupTyping: vi.fn(),
  streamGroupChat: vi.fn(),
  streamGroupClose: vi.fn(),
  streamGroupResync: vi.fn(),
  // task-06（D-001/D-006）：会话列表变更信号订阅——捕获 opts（onEvent /
  // onReconnected 触发 invalidate）+ close 调用断言（unmount 关订阅）。
  // 2026-08-30 补 mock 债（f7f99a2f session-usage-stats，同 page.test）。
  // vi.fn(async () => …) 推断为零参签名，转发层 (...args) 展开会 TS2556——
  // 实现带 rest 形参对齐转发层。
  getSessionUsage: vi.fn(async (..._args: unknown[]) => ({
    totals: {
      model: "totals",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      api_requests: 0,
    },
    by_model: [],
  })),
  subscribeAgentSessionsEvents: vi.fn(),
  eventsClose: vi.fn(),
  deleteAgentSession: vi.fn(),
  machinesHook: vi.fn(),
  profilesHook: vi.fn(),
  listProviders: vi.fn(),
  getProviderQuota: vi.fn(),
  listWorkspaces: vi.fn(),
  fetchMyBindings: vi.fn(),
  // quick 群 PPM 项目化：向导项目/项目人员/项目关联工作区数据源。
  listSimpleProjects: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjectWorkspaces: vi.fn(),
  // task-07（D-106）：预会话上下文行变更名解析（session-panel getChange）。
  getChange: vi.fn(),
  // task-10（X-009）：SessionListPanel「关联」下拉选项数据源。
  listChanges: vi.fn(),
  listQuicklogEntries: vi.fn(),
  // task-10/task-11：quicklog 预会话标题解析（session-panel getQuicklogDetail，
  // task-11 落地后渲染树消费；本卡 mock 前向兼容）。
  getQuicklogDetail: vi.fn(),
  // task-03（2026-08-26-workspace-git-status / Plan Review I-1）：页头 workspace
  // scope 挂紧凑态 Git 状态条，消费 @/lib/git-log 的 useGitLogStatus——固定
  // fixture mock，消除未 mock 的 status 请求噪声。
  useGitLogStatus: vi.fn(),
  // D-004@v1 深链：useSearchParams 返回值（每用例可改写）
  searchParams: new URLSearchParams(),
  // ql-20260824-001：选中态 URL 同步（?session= 写入/移除）的 replace 捕获
  routerReplace: vi.fn(),
  // task-06：SessionListPanel props 捕获（defaultExpandedWorkspaceId 断言用）
  lastListPanelProps: null as Record<string, unknown> | null,
  // task-10：SessionPanel props 捕获（quicklog preContext 合成断言用——
  // quickId 首句上送链属 task-11，本卡经 props 层断言不依赖其落地时序）。
  lastSessionPanelProps: null as Record<string, unknown> | null,
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
  // task-07：群聊分区 + 建群向导（CreateGroupWizard 经真实模块 import 消费）。
  listGroupChats: (...args: unknown[]) => mocks.listGroupChats(...args),
  createGroupChat: (...args: unknown[]) => mocks.createGroupChat(...args),
  // task-09：群视图挂载点成员面板（MemberPanel 经真实模块 import 消费）。
  getGroupChat: (...args: unknown[]) => mocks.getGroupChat(...args),
  updateGroupMember: (...args: unknown[]) => mocks.updateGroupMember(...args),
  removeGroupMember: (...args: unknown[]) => mocks.removeGroupMember(...args),
  resetGroupMemberMemory: (...args: unknown[]) =>
    mocks.resetGroupMemberMemory(...args),
  // task-08：群聊面板消费（GroupChatPanel 经真实模块 import 消费）。
  sendGroupMessage: (...args: unknown[]) => mocks.sendGroupMessage(...args),
  sendGroupTyping: (...args: unknown[]) => mocks.sendGroupTyping(...args),
  streamGroupChat: (...args: unknown[]) => mocks.streamGroupChat(...args),
  // maxLogTimestamp 纯函数（面板回放游标）：同实现重述（mock 工厂内无法引用
  // 真模块导出；语义=取最大 ISO timestamp）。
  maxLogTimestamp: (
    logs: Array<{ timestamp?: string | null }>,
  ): string | undefined =>
    logs.reduce<string | undefined>(
      (acc, l) =>
        l.timestamp && (!acc || l.timestamp > acc) ? l.timestamp : acc,
      undefined,
    ),
  // task-06：门户挂载订阅的哑信号通道（opts 经包装转发捕获到 mocks）。
  getSessionUsage: (...args: unknown[]) => mocks.getSessionUsage(...args),
  subscribeAgentSessionsEvents: (...args: unknown[]) =>
    mocks.subscribeAgentSessionsEvents(...args),
}));

// task-08（D-004@v1）：门户挂载时 useSearchParams 解析 ?session=——jsdom 无
// app router 上下文时返回 null（sessions-portal.tsx:78 即原 18 红根因），
// 按 runtimes/__tests__/page.test.tsx 惯例 mock 成可控 searchParams。
vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  // ql-20260824-001：选中态 URL 同步消费 usePathname + useRouter.replace。
  usePathname: () => "/sessions",
  useRouter: () => ({
    replace: (...args: unknown[]) => mocks.routerReplace(...args),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
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

// task-07：建群向导步骤②邀请候选数据源（成员列表）。
vi.mock("@/lib/ppm/project", () => ({
  // quick 群 PPM 项目化：向导项目下拉 + 项目人员候选数据源。
  listSimpleProjects: (...args: unknown[]) => mocks.listSimpleProjects(...args),
  listProjectMembers: (...args: unknown[]) => mocks.listProjectMembers(...args),
}));

vi.mock("@/lib/workspace", () => ({
  listProjectWorkspaces: (...args: unknown[]) =>
    mocks.listProjectWorkspaces(...args),
}));

vi.mock("@/lib/workspace-members", () => ({
  listMembers: (...args: unknown[]) => mocks.listMembers(...args),
}));

// task-07（D-106）：session-panel 上下文行变更名解析数据源；
// task-10（X-009）：SessionListPanel「关联」下拉变更选项数据源。
vi.mock("@/lib/changes", () => ({
  getChange: (...args: unknown[]) => mocks.getChange(...args),
  listChanges: (...args: unknown[]) => mocks.listChanges(...args),
}));

// task-10：SessionListPanel「关联」下拉快速修复选项数据源；task-11 起
// session-panel 标题解析消费 getQuicklogDetail（mock 前向兼容）。
vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: (...args: unknown[]) =>
    mocks.listQuicklogEntries(...args),
  getQuicklogDetail: (...args: unknown[]) => mocks.getQuicklogDetail(...args),
}));

// task-03（2026-08-26-workspace-git-status / Plan Review I-1）：页头紧凑态
// Git 状态条（workspace scope 条件挂载）消费 useGitLogStatus——整模块 mock
// 固定 fixture（渲染树仅消费此 hook），消除未 mock 的 status 请求噪声。
vi.mock("@/lib/git-log", () => ({
  useGitLogStatus: (...args: unknown[]) => mocks.useGitLogStatus(...args),
}));

// task-10：SessionPanel 包一层 props 捕获（渲染真实组件零行为差异）——
// quicklog preContext 合成（{workspaceId, quickId, runtimeId}）经 props 层
// 断言，不依赖 task-11 的 quicklog_id 请求链落地时序。
vi.mock("@/components/daemon/session-panel", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/daemon/session-panel")
  >("@/components/daemon/session-panel");
  const ActualSessionPanel = actual.SessionPanel;
  return {
    ...actual,
    SessionPanel: (props: Parameters<typeof ActualSessionPanel>[0]) => {
      mocks.lastSessionPanelProps = props as unknown as Record<string, unknown>;
      return <ActualSessionPanel {...props} />;
    },
  };
});

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
// task-10（FR-04 / D-006@v1）：quicklog scope 固件（qlId 为 QUICKLOG 短码）。
const QUICKLOG_SCOPE: SessionListScope = {
  kind: "quicklog",
  workspaceId: "ws-1",
  qlId: "ql-20260824-014",
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

/**
 * 展开左栏「非工作区」分组（ql-20260824-001 起分组默认折叠；默认固件会话
 * workspace_id=null 落该组）。
 */
async function openNoWorkspaceGroup() {
  const head = await screen.findByRole("button", {
    name: "工作区分组 非工作区",
  });
  fireEvent.click(head);
  await waitFor(() => expect(head).toHaveAttribute("aria-expanded", "true"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
  mocks.lastListPanelProps = null;
  mocks.lastSessionPanelProps = null;
  // machineCandidates 与 items 同源注入：门户 picker/两层筛选已改读融合候选
  // （task-10，2026-08-28-daemon-agent-share），漏配机器层 tab 全空。
  const defaultMachines = [
    makeMachine(),
    makeMachine({
      id: "m-2",
      hostname: "machine-2",
      runtimes: [makeRuntime({ id: "rt-2", provider: "codex" })],
    }),
  ];
  mocks.machinesHook.mockReturnValue({
    items: defaultMachines,
    sharedToMe: [],
    machineCandidates: defaultMachines,
    total: defaultMachines.length,
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
  // task-10（X-009）：「关联」下拉选项数据源默认成功空集（workspace scope
  // 既有用例渲染下拉但选项为空，零干扰）。
  mocks.listChanges.mockResolvedValue({ items: [], total: 0 });
  mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
  // quick 群 PPM 项目化：向导项目候选默认空集（建群用例内覆写）。
  mocks.listSimpleProjects.mockResolvedValue([]);
  mocks.listProjectMembers.mockResolvedValue([]);
  mocks.listProjectWorkspaces.mockResolvedValue([]);
  // task-07：群聊分区默认空集（既有用例零渲染干扰）+ 建群提交默认成功 +
  // 邀请候选默认空集（向导步骤②数据源）。
  mocks.listGroupChats.mockResolvedValue([]);
  mocks.createGroupChat.mockResolvedValue({
    id: "g-new",
    session_id: "s-g-new",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 4,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [],
  });
  mocks.listMembers.mockResolvedValue([]);
  // task-09：群详情（挂载点成员面板数据源）默认返回空成员群——既有用例零
  // 渲染干扰（群分区用例内按 fixture 覆写）。
  mocks.getGroupChat.mockResolvedValue({
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 4,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [],
  });
  mocks.getQuicklogDetail.mockResolvedValue({
    ql_id: "ql-20260824-014",
    title: "悬浮球去紫改青",
    status: "completed",
    placeholder: false,
  });
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
  // task-08：群流订阅默认空连接（群聊面板渲染树消费；群分区用例真实装配）。
  mocks.sendGroupMessage.mockResolvedValue({
    carrier_run_id: "r-carrier",
    log_id: "l-sent",
    mentioned_member_ids: [],
    mention_all: false,
    triggered: [],
  });
  mocks.sendGroupTyping.mockResolvedValue(undefined);
  mocks.streamGroupChat.mockReturnValue({
    close: mocks.streamGroupClose,
    getLastEventId: () => null,
    resync: mocks.streamGroupResync,
  });
  // task-06：订阅 mock 返回 { close }（unmount 断言）；clearAllMocks 只清调用
  // 记录不清返回值，此处随 beforeEach 统一重建（与上方 mockReturnValue 同款）。
  mocks.subscribeAgentSessionsEvents.mockReturnValue({
    close: mocks.eventsClose,
  });
  mocks.fetchPendingDialogs.mockResolvedValue([]);
  mocks.fetchSessionDialogHistory.mockResolvedValue([]);
  mocks.listSessionRuns.mockResolvedValue([]);
  // task-03：Git 状态条固定 fixture（干净工作区常态——分支 main/零计数，
  // 紧凑态只渲染分支徽标，零文本噪声不干扰既有断言）。
  mocks.useGitLogStatus.mockReturnValue({
    data: {
      git_mode: "git",
      branch: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      dirty: { files_changed: 0, additions: 0, deletions: 0, untracked_count: 0 },
      head_short: "abcd1234",
      empty: false,
      fetch: { performed: true, error: null },
      synced_at: "2026-08-26T00:31:00Z",
    },
    isPending: false,
    isError: false,
    error: null,
  });
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
      // quick 风险审查修（2026-09-01）旧债顺手补：非归档视图显式 archived=false。
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
        archived: false,
      });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 全局列表条目照常渲染（门户默认态可交互；分组默认折叠，先展开再断言）
    await openNoWorkspaceGroup();
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
    // task-03：全局 scope 页头不挂 Git 状态条（CC-08：仅 workspace scope 挂载）
    expect(screen.queryByTestId("git-status-bar")).toBeNull();
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
        archived: false,
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
    // task-03：workspace scope 页头 actions 槽挂紧凑态 Git 状态条（CC-08；
    // fixture 干净工作区 → 紧凑态只出分支徽标「⎇ main」）
    expect(screen.getByTestId("git-status-bar")).toHaveAttribute(
      "data-variant",
      "compact",
    );
    expect(screen.getByTestId("git-status-bar-branch")).toHaveTextContent(
      "⎇ main",
    );
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
        archived: false,
      });
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 右侧空门户态；树单组组头「＋」（新建入口，经门户双传 change 上下文）
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.queryByLabelText("新建会话表单")).toBeNull();
    // task-03：change scope 不挂 Git 状态条（CC-08：虽携带 workspaceId，
    // 「围绕某变更的会话」语义偏离工作区健康状态主题）
    expect(screen.queryByTestId("git-status-bar")).toBeNull();
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
        archived: false,
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
        archived: false,
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

// ── 2.5 quicklog scope（task-10 / FR-04 / D-006@v1，X-008 消费分支补齐） ─────

describe("SessionsPortal quicklog scope（task-10 / D-006@v1）", () => {
  it("标题「智能体会话 · 快速修复 · <qlId>」；列表 {limit:500, workspace_id, ql_id} 三传；defaultExpandedWorkspaceId 预展开；空态文案提示快速修复；X-009 不渲染「关联」下拉", async () => {
    renderPortal(QUICKLOG_SCOPE);

    // X-008 消费点三（portalTitle）：固定后缀 + ql 短码（scope.qlId 本身即短码）
    expect(
      screen.getByRole("heading", {
        name: "智能体会话 · 快速修复 · ql-20260824-014",
      }),
    ).toBeTruthy();
    // X-008 消费点一（queryFn 透传）：workspace_id + ql_id 双传（树一次拉取 500）
    await waitFor(() => {
      expect(mocks.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
        workspace_id: "ws-1",
        ql_id: "ql-20260824-014",
        archived: false,
      });
    });
    // X-008 消费点五（defaultExpandedWorkspaceId）：quicklog 同 workspace/change 预展开
    expect(mocks.lastListPanelProps?.defaultExpandedWorkspaceId).toBe("ws-1");
    // task-03：quicklog scope 不挂 Git 状态条（CC-08，同 change scope 排除理由）
    expect(screen.queryByTestId("git-status-bar")).toBeNull();
    // X-008 消费点六（空态文案）：提示在当前快速修复下创建会话
    expect(screen.getByLabelText("门户空态")).toBeTruthy();
    expect(screen.getByText(/在当前快速修复下创建会话/)).toBeTruthy();
    // X-009：quicklog scope 自身已按关联过滤，选项查询零发起
    expect(mocks.listChanges).not.toHaveBeenCalled();
    expect(mocks.listQuicklogEntries).not.toHaveBeenCalled();
  });

  it("组头「＋」→ 两步浮层选完 → preContext 合成 {workspaceId, quickId, runtimeId}（X-13 双传语义 quicklog 版；经 props 捕获断言，不依赖 task-11 落地时序）", async () => {
    renderPortal(QUICKLOG_SCOPE);

    // quicklog 树单组组头「＋」（组名解析失败兜底「当前工作区」）
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

    // preContext 三字段合成（quickId 传 scope.qlId；quickId 首句上送
    // quicklog_id 属 task-11 契约，本卡仅断言门户合成层）
    await waitFor(() => {
      expect(mocks.lastSessionPanelProps?.preContext).toEqual({
        workspaceId: "ws-1",
        quickId: "ql-20260824-014",
        runtimeId: "rt-1",
      });
    });
    expect(mocks.createSession).not.toHaveBeenCalled(); // 首句未发零残留
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
    const machines = [
      makeMachine({ id: "m-off", hostname: "machine-off", status: "offline" }),
    ];
    mocks.machinesHook.mockReturnValue({
      items: machines,
      sharedToMe: [],
      machineCandidates: machines,
      total: machines.length,
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
    //（分组默认折叠，先展开「非工作区」组再点条目）
    await openNoWorkspaceGroup();
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
      screen.getByRole("button", { name: "智能体tab Claude Code" }),
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
    const machines = [
      makeMachine({ id: "m-2", hostname: "machine-2", runtimes: [makeRuntime({ id: "rt-2", provider: "codex", status: "offline" })] }),
    ];
    mocks.machinesHook.mockReturnValue({
      items: machines,
      sharedToMe: [],
      machineCandidates: machines,
      total: machines.length,
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
      screen.getByRole("button", { name: "智能体tab Codex" }),
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

// ── 7. 选中态 URL 同步（ql-20260824-001：刷新保持当前会话） ────────────────

describe("SessionsPortal 选中态 URL 同步（ql-20260824-001）", () => {
  /**
   * mock 环境下 searchParams 是冻结快照（真实 Next 会随 replace 更新并触发
   * 重渲染）——改写 mocks.searchParams 后需触发一次门户重渲染（开/关两步
   * 浮层），后续事件闭包才能读到新参数（清参路径依赖当前参数非空才触发）。
   */
  async function nudgeRerender() {
    fireEvent.click(
      screen.getByRole("button", { name: "在 非工作区 新建会话" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull(),
    );
  }

  it("列表选中 → replace 写 ?session=<id>（scroll:false）+ 列表所在组自动展开定位", async () => {
    renderPortal();
    await openNoWorkspaceGroup();
    fireEvent.click(
      screen.getByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions?session=s-1", {
        scroll: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("会话面板")).toBeTruthy(),
    );
  });

  it("深链恢复（URL 已带同参）再点同一会话 → 参数一致去重，不 replace", async () => {
    mocks.searchParams = new URLSearchParams("session=s-1");
    renderPortal();
    await waitFor(() =>
      expect(screen.getByLabelText("会话面板")).toBeTruthy(),
    );
    // 选中会话在非工作区组 → 组自动展开，条目直接可点
    fireEvent.click(
      await screen.findByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });

  it("删除选中会话 → 选中清空 + replace 移除 ?session=", async () => {
    renderPortal();
    await openNoWorkspaceGroup();
    fireEvent.click(
      screen.getByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("会话面板")).toBeTruthy(),
    );
    expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions?session=s-1", {
      scroll: false,
    });
    // 模拟 Next 参数已随上一次 replace 更新为 session=s-1
    mocks.searchParams = new URLSearchParams("session=s-1");
    mocks.routerReplace.mockClear();
    await nudgeRerender();

    fireEvent.click(
      screen.getByRole("button", { name: "删除 整理这周的会议纪要" }),
    );
    const okBtn = await waitFor(() => {
      const btn = document.querySelector(
        ".ant-modal-confirm-btns .ant-btn-primary",
      ) as HTMLElement | null;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
    fireEvent.click(okBtn);
    await waitFor(() =>
      expect(screen.getByLabelText("门户空态")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions", {
        scroll: false,
      }),
    );
  });

  it("进入预会话 → replace 清参；首句创建成功 → replace 写新会话 id", async () => {
    renderPortal();
    await openNoWorkspaceGroup();
    fireEvent.click(
      screen.getByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions?session=s-1", {
        scroll: false,
      }),
    );
    // 模拟 Next 参数已随上一次 replace 更新为 session=s-1
    mocks.searchParams = new URLSearchParams("session=s-1");
    mocks.routerReplace.mockClear();

    await enterPreSession("在 非工作区 新建会话");
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions", {
        scroll: false,
      }),
    );

    // 首句创建成功 → 切真会话并写新 id
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "第一句话开个会话" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith(
        "/sessions?session=s-new",
        { scroll: false },
      ),
    );
  });
});

// ── 8. 会话列表变更信号订阅（2026-08-24-sessions-live-updates task-06 / D-001 / D-006） ──

describe("SessionsPortal 会话列表变更信号订阅（task-06）", () => {
  /** 取挂载时 subscribeAgentSessionsEvents 收到的 opts（mock 工厂捕获入参）。 */
  function getSubscriptionOpts(): {
    onEvent: () => void;
    onReconnected?: () => void;
  } {
    const opts = mocks.subscribeAgentSessionsEvents.mock.calls[0]?.[0] as
      | { onEvent: () => void; onReconnected?: () => void }
      | undefined;
    // 显式守卫窄化（tsc 不经 expect 收窄）；订阅 effect 随挂载同步跑，必命中。
    if (!opts) throw new Error("subscription opts not captured on mount");
    return opts;
  }

  it("onEvent（收到变更信号）→ invalidate agentSessions 前缀命中树查询，listAgentSessions 调用次数增加（D-001 lazy refresh：信号→重拉）", async () => {
    renderPortal();
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    const opts = getSubscriptionOpts();
    const callsBefore = mocks.listAgentSessions.mock.calls.length;

    act(() => {
      opts.onEvent();
    });
    await waitFor(() =>
      expect(mocks.listAgentSessions.mock.calls.length).toBeGreaterThan(
        callsBefore,
      ),
    );
  });

  it("onReconnected（断线重连成功）→ 同样补一次 invalidate 重拉（D-006：不回放历史，重连补拉兜断连窗口）", async () => {
    renderPortal();
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    const opts = getSubscriptionOpts();
    const callsBefore = mocks.listAgentSessions.mock.calls.length;

    act(() => {
      opts.onReconnected?.();
    });
    await waitFor(() =>
      expect(mocks.listAgentSessions.mock.calls.length).toBeGreaterThan(
        callsBefore,
      ),
    );
  });

  // 2026-08-25 P1 修复：SSE 变更信号去抖（leading+trailing，400ms）——一轮会话
  // 活动典型 2~3 帧，裸 invalidate 每帧全量重拉 limit=500 列表成风暴。窗口期内
  // 密集信号应合并为：leading 立即一次 + 窗口尾 trailing 一次。
  it("onEvent 风暴去抖：400ms 窗口内 3 帧密集信号 → leading 立即 1 次 + trailing 合并 1 次（共 2 次重拉）", async () => {
    renderPortal();
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    const opts = getSubscriptionOpts();
    const callsBefore = mocks.listAgentSessions.mock.calls.length;

    act(() => {
      opts.onEvent();
      opts.onEvent();
      opts.onEvent();
    });
    // leading：首帧信号立即触发一次刷新。
    await waitFor(() =>
      expect(mocks.listAgentSessions.mock.calls.length).toBe(callsBefore + 1),
    );

    // trailing：400ms 窗口关闭后合并的一次刷新（600ms 实等覆盖窗口）。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(mocks.listAgentSessions.mock.calls.length).toBe(callsBefore + 2);
  }, 10000);

  it("unmount → sub.close() 关闭订阅（卸载不留残留连接/幽灵 invalidate）", () => {
    const { unmount } = renderPortal();
    getSubscriptionOpts();
    expect(mocks.eventsClose).not.toHaveBeenCalled();

    unmount();
    expect(mocks.eventsClose).toHaveBeenCalledTimes(1);
  });
});

// ── 9. 群聊分区与建群向导（task-07 / 2026-09-01-session-group-chat / FR-01 / FR-04） ──

/** 群列表项固件（成员摘要 + last_message）。 */
function makeGroupListItem(): GroupChatListItemRead {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 4,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [
      {
        id: "mem-1",
        member_type: "agent",
        display_name: "小码",
        runtime_id: "rt-1",
        joined_at: "2026-09-01T00:00:00Z",
        shadow_status: "none",
        team_enabled: false,
      },
      {
        id: "mem-2",
        member_type: "user",
        display_name: "林一",
        user_id: "u-lin",
        joined_at: "2026-09-01T00:00:00Z",
        shadow_status: "none",
        team_enabled: false,
      },
    ],
    online_member_ids: [],
    last_message: null,
  };
}

describe("SessionsPortal 群聊分区（task-07）", () => {
  it("群行渲染（GET /api/daemon/group-chats 供数）+ 点击群行 → 右侧挂载点占位 + ?session= 清除 + 会话面板让位", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    // task-09：挂载点右列成员面板数据源（群详情含六要素成员）。
    mocks.getGroupChat.mockResolvedValue({
      ...makeGroupListItem(),
    });
    renderPortal();
    await waitFor(() => expect(mocks.listGroupChats).toHaveBeenCalledTimes(1));

    const row = await screen.findByRole("button", {
      name: "群聊 前端攻坚小分队",
    });
    // 先选中一个单聊（写 ?session=），再点群行 → 让位 + 清参。
    await openNoWorkspaceGroup();
    fireEvent.click(
      screen.getByRole("button", { name: "会话 整理这周的会议纪要" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("会话面板")).toBeTruthy(),
    );
    expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions?session=s-1", {
      scroll: false,
    });

    fireEvent.click(row);
    const mount = await screen.findByTestId("group-chat-panel-mount");
    expect(mount).toHaveAttribute("data-group-id", "g-1");
    expect(mount.textContent).toContain("前端攻坚小分队");
    expect(mount.textContent).toContain("2 名成员 · 1 位 Agent · 1 位用户");
    // task-09：右列成员面板就位（群详情供数，分组渲染成员）。
    expect(await screen.findByTestId("group-member-panel")).toBeTruthy();
    expect(mocks.getGroupChat).toHaveBeenCalledWith("g-1");
    expect(screen.getByText("Agent 成员（1）")).toBeTruthy();
    expect(screen.getByText("用户成员（1）")).toBeTruthy();
    // 右侧让位：会话面板/空门户/预会话均不出现。
    expect(screen.queryByLabelText("会话面板")).toBeNull();
    expect(screen.queryByLabelText("门户空态")).toBeNull();
    expect(screen.queryByTestId("session-pre-session-panel")).toBeNull();
    // ?session= 清除（群选中态本卡不落 URL——task-08 群视图再议）。
    mocks.searchParams = new URLSearchParams("session=s-1");
    mocks.routerReplace.mockClear();
    // mock searchParams 是冻结快照——开/关两步浮层触发一次重渲染（同
    // nudgeRerender 先例），此后事件闭包才能读到新参数。
    fireEvent.click(
      screen.getByRole("button", { name: "在 非工作区 新建会话" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(screen.queryByTestId("pre-session-picker-mask")).toBeNull(),
    );
    fireEvent.click(row);
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith("/sessions", {
        scroll: false,
      }),
    );
  });

  it("分区头「＋」→ 三步向导建群成功 → createGroupChat 提交 + 新群挂载点选中 + 群列表 invalidate 重拉", async () => {
    // quick 群 PPM 项目化：项目候选 + 项目关联工作区（群工作区后端推导，
    // 提交不带 workspace_id）。
    mocks.listSimpleProjects.mockResolvedValue([
      { id: "pj-1", project_name: "SillyHub 平台" },
    ]);
    mocks.listProjectWorkspaces.mockResolvedValue([
      { workspace_id: "ws-1", name: "SillyHub", status: "active", type: null },
    ]);
    renderPortal();
    fireEvent.click(
      await screen.findByRole("button", { name: "新建群聊" }),
    );
    // 向导打开（antd Modal 标题）。
    expect(await screen.findByText("新建群聊")).toBeTruthy();

    // ① 群信息：群名 + 项目下拉（quick：无工作区选择）。
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "前端攻坚小分队" },
    });
    const pjInput = document.getElementById("cgw-project");
    const pjRoot = pjInput?.closest(".ant-select") as HTMLElement;
    fireEvent.mouseDown(
      (pjRoot.querySelector(".ant-select-selector") as HTMLElement) ??
        pjRoot,
    );
    const pjOption = await waitFor(() => {
      const hit = [
        ...document.querySelectorAll(".ant-select-item-option-content"),
      ].find((el) => el.textContent?.trim() === "SillyHub 平台");
      if (!hit) throw new Error("project option not found");
      return hit as HTMLElement;
    });
    fireEvent.mouseDown(pjOption.closest(".ant-select-item-option") as HTMLElement);
    fireEvent.click(pjOption.closest(".ant-select-item-option") as HTMLElement);
    await act(async () => {
      await Promise.resolve();
    });
    // 关联工作区提示就位（下一步放行前提）。
    await waitFor(() =>
      expect(screen.getByTestId("cgw-workspace-hint")).toHaveTextContent(
        "已关联 1 个工作区",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // ② 邀请用户（默认空，直接下一步）。
    fireEvent.click(await screen.findByRole("button", { name: "下一步" }));

    // ③ Agent 成员（0 张卡片合法——纯用户群）直接创建。
    fireEvent.click(
      await screen.findByRole("button", { name: "创建群聊" }),
    );
    await waitFor(() =>
      expect(mocks.createGroupChat).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createGroupChat).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "前端攻坚小分队",
        project_id: "pj-1",
        agent_cross_mention: true,
        cross_mention_depth: 4,
        context_window: 20,
      }),
    );
    // quick：群工作区后端推导——提交不带 workspace_id。
    expect(
      (mocks.createGroupChat.mock.calls[0]?.[0] as Record<string, unknown>)
        .workspace_id,
    ).toBeUndefined();
    // 向导关闭 + 新群挂载点就位 + 群列表 invalidate 重拉（新群落分区顶部）。
    await waitFor(() => {
      expect(screen.getByTestId("group-chat-panel-mount")).toHaveAttribute(
        "data-group-id",
        "g-new",
      );
    });
    await waitFor(() =>
      expect(mocks.listGroupChats.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("change scope 不渲染群分区（「围绕某变更的会话」语义偏离，CC-08 同款排除）", async () => {
    renderPortal(CHANGE_SCOPE);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    expect(screen.queryByLabelText("群聊分区")).toBeNull();
    expect(mocks.listGroupChats).not.toHaveBeenCalled();
  });

  it("SSE 变更信号 → invalidate groupChats 前缀命中群列表重拉（design §8 群事件同通道）", async () => {
    renderPortal();
    await waitFor(() => expect(mocks.listGroupChats).toHaveBeenCalled());
    const opts = mocks.subscribeAgentSessionsEvents.mock.calls[0]?.[0] as
      | { onEvent: () => void }
      | undefined;
    if (!opts) throw new Error("subscription opts not captured");
    const callsBefore = mocks.listGroupChats.mock.calls.length;
    act(() => {
      opts.onEvent();
    });
    await waitFor(() =>
      expect(mocks.listGroupChats.mock.calls.length).toBeGreaterThan(
        callsBefore,
      ),
    );
  });
});
