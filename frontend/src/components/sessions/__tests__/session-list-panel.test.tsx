/**
 * SessionListPanel 单测（2026-08-23-sessions-workspace-hub task-05 工作区树重构
 * / FR-01 / FR-02 / D-103 / D-105 / D-107 / R-03 / R-05 / X-11）。
 *
 * 依据：
 *   - components/sessions/session-list-panel.tsx（本 task 实现）
 *   - tasks/task-05.md acceptance：分组/小节/chips（创建人 null→"—"）渲染正确、
 *     非工作区末尾组可新建回调、两层筛选过滤生效且「全部」清空、筛选态隐藏
 *     小节标题、状态筛选/批量删除/搜索保留、组内 50 截断+显示全部、
 *     scope=workspace/change 行为不回归
 *
 * ── 旧断言迁移清单（R-06 前置：逐条迁移，非删断言凑绿） ──────────────────
 * 旧版（2026-08-14/22 平铺列表）断言 → 新落点：
 *   1. 初次渲染默认查询 limit → §1「一次拉取 limit=500」；chips 断言拆到
 *      §2（树形态 chips 无 📂/🖥，机器信息由组头/小节承载——语义迁移非删除）
 *   2. 引擎胶囊 tab（provider 参数）→ 全局形态退役，语义落 §8 change scope
 *      「引擎 Segmented 照常带 provider 参数」（change 独立页维持现状）
 *   3. 状态下拉 status 参数 → §5 树形态组内视图过滤（不触发新查询）+
 *      §8 change scope 服务端参数
 *   4. 机器单选 machine_id / 多选客户端过滤 → 单选语义落 §8 change scope；
 *      多选 Select 全局退役（被机器 tab 取代，见退役清单）
 *   5. 搜索回车触发 q → §5 树形态回车应用为视图过滤（不触发新查询）+
 *      §8 change scope 服务端 q 参数
 *   6. chips 快照缺省回退/离线划线 → §3（引擎回退 provider；离线机器小节点
 *      灰 + （离线）后缀——离线划线语义随 🖥 chip 退役迁移到小节标题）
 *   7. 点击 onSelect + aria-pressed → §6 原样迁移
 *   8. 空态/错误态 → §7 原样迁移（树形态空态含分组头 + 无匹配提示）
 *   9. 虚拟滚动只渲染可视区（全局）→ **有意删除**：全局 useVirtualizer 退役
 *      （task-05 implementation 第 5 点，分组+组内截断取代，R-04）；change
 *      分支虚拟滚动仍在（滚动容器 data-testid="session-scroll" 存在性由 §8
 *      渲染路径隐式覆盖）
 *   10. 加载更多（真分页 offset 递增）→ §8 change scope（全局一次拉取无分页）
 *   11-13. scope 数据源/筛选条/全字段渲染 → §8（workspace=树单组 limit 500；
 *       change=现状平铺 limit 50）+ §2（全字段 chips 落树形态）
 *
 * ── 全局形态有意退役的断言清单 ────────────────────────────────────────────
 *   - 引擎胶囊 tab（Segmented 全局 provider 参数即查）
 *   - 全局 useVirtualizer 可视区渲染（80 条只渲染 ≪80 行）
 *   - 机器多选 Select（单选 server machine_id / 多选客户端过滤组合）
 *   以上由两层筛选 tab（§4）+ 组内截断（§6 截断用例）承接（X-11）。
 *
 * mock 策略：直接 mock 组件消费的模块（@/lib/daemon 的 listAgentSessions +
 * AGENT_SESSIONS_TREE_FETCH_LIMIT 常量 / @/lib/use-daemon-machines /
 * @/lib/workspaces 的 listWorkspaces），@/lib/api 保留真实（ApiError
 * instanceof 用）。
 *
 * jsdom 已知坑：change 分支虚拟滚动的 observeElementRect 同步读滚动容器
 * offsetWidth/offsetHeight（jsdom 恒 0），测试内对 [data-testid=
 * "session-scroll"] 打 600/320 桩（树形态不依赖）。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

import {
  SessionListPanel,
  SESSION_TREE_EXPANSION_LS_KEY,
  SESSION_TREE_FILTER_LS_KEY,
  GROUP_SECTION_COLLAPSED_LS_KEY,
  sessionListPollInterval,
  type SessionListScope,
} from "@/components/sessions/session-list-panel";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import type { AgentLogListItem } from "@/lib/agent-logs";
import type { Workspace } from "@/lib/workspaces";
import { useSession } from "@/stores/session";
import { queryAntdConfirm, queryAntdConfirmTitle, closestAntdSelect, queryAntdSelectZone, queryAntdSelectClear, queryAntdSelectMultiple, queryAntdSegmented, closestAntdSelectOption } from "@/test/dom-queries";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  // v2 两 scope 端点保留 mock 仅为 D-003@v2 零调用断言（数据源走全局端点）。
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
  // task-07（2026-09-01-session-group-chat）：群聊分区独立数据源。
  listGroupChats: vi.fn(),
  machinesHook: vi.fn(),
  machinesRefetch: vi.fn(),
  listWorkspaces: vi.fn(),
  // task-10（X-009）：「关联」下拉选项数据源（变更列表 + 快速修复列表）。
  listChanges: vi.fn(),
  listQuicklogEntries: vi.fn(),
  // task-06（2026-08-28-session-ppm-task-binding / FR-05）：「关联」下拉 PPM
  // 任务/问题选项数据源（口径同 @ 联想：进行中、按当前用户）。
  listPersonalPlanTasks: vi.fn(),
  listProblems: vi.fn(),
  // 2026-09-08-session-list-liveness-dot task-03：活性小灯数据源（use-session-
  // liveness hook 经 listWorkspaceAgentLogs 拉取——既有 mock 集没有该模块，防
  // jsdom 真实 fetch 噪声，Grill CC-12）。
  listWorkspaceAgentLogs: vi.fn(),
  // quick（ql-20260916-014）：工作区查询统一 workspace-switcher 键后 queryFn
  // 并拉 my-bindings（ql-20260916-006）——不 mock 时真实 fetch 失败路径的异步
  // 延迟在 CI 慢机上晚于组头名称断言（兜底「当前工作区」误显 6 用例红）。
  fetchMyBindings: vi.fn(),
}));

// 组件只消费 listAgentSessions + 树拉取上限常量（类型导入编译期擦除），
// 局部 mock 不加载真实 daemon.ts；两 scope 端点 mock 供零调用断言。
// task-07：listGroupChats（群分区数据源）+ createGroupChat/PROVIDER_META
//（panel 经 create-group-wizard MemberFacepile 间接引入该模块的命名导出，
// 不渲染向导本体，桩值不被调用）。
vi.mock("@/lib/daemon", () => ({
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  listWorkspaceAgentSessions: (...args: unknown[]) =>
    mocks.listWorkspaceAgentSessions(...args),
  listChangeSessions: (...args: unknown[]) => mocks.listChangeSessions(...args),
  listGroupChats: (...args: unknown[]) => mocks.listGroupChats(...args),
  createGroupChat: vi.fn(),
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "" },
    codex: { label: "Codex", icon: "🟢", color: "" },
    pi: { label: "Pi", icon: "🩷", color: "" },
    cursor: { label: "Cursor", icon: "🟡", color: "" },
  },
  // ql-20260908-007：单一源常量随真实现同值 mock（智能体下拉选项派生用）。
  SESSION_SUPPORTED_PROVIDERS: ["claude", "codex", "pi", "cursor"],
  SESSION_ENGINE_OPTIONS: [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
    { value: "pi", label: "Pi" },
    { value: "cursor", label: "Cursor" },
  ],
  AGENT_SESSIONS_TREE_FETCH_LIMIT: 500,
}));

// 2026-09-08-session-list-liveness-dot task-03（Grill CC-12）：hook 数据源桩——
// 组件经 use-session-liveness 间接消费（类型导入编译期擦除，只桩该函数即可）。
vi.mock("@/lib/agent-logs", () => ({
  listWorkspaceAgentLogs: (...args: unknown[]) =>
    mocks.listWorkspaceAgentLogs(...args),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

// quick（ql-20260916-014）：工作区 queryFn 的 my-bindings 数据源（组件只消费
// items，bindings 供 workspace-switcher 超集；默认空集零干扰）。
vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBindings: (...args: unknown[]) => mocks.fetchMyBindings(...args),
}));

// task-10（X-009）：「关联」下拉选项数据源 mock（组件仅消费两个列表函数）。
vi.mock("@/lib/changes", () => ({
  listChanges: (...args: unknown[]) => mocks.listChanges(...args),
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: (...args: unknown[]) =>
    mocks.listQuicklogEntries(...args),
}));

// task-06（FR-05）：PPM 任务/问题选项数据源 mock（组件仅消费两个列表函数）。
vi.mock("@/lib/ppm/task", () => ({
  listPersonalPlanTasks: (...args: unknown[]) =>
    mocks.listPersonalPlanTasks(...args),
}));

vi.mock("@/lib/ppm/problem", () => ({
  listProblems: (...args: unknown[]) => mocks.listProblems(...args),
}));

// ql-20260831-013：归档/取消归档结果 toast 走 useNotify（App.useApp 上下文
// message，测试环境无 <AntApp> 包裹——挂 spy 断言，不起 antd message DOM）。
const notifyMocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) =>
    err instanceof Error ? err.message : "操作失败",
  useNotify: () => notifyMocks,
}));

// ── jsdom 虚拟滚动桩：change 分支 scroll 容器给出非零视口 ────────────────

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
  } as DaemonRuntimeRead;
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
    runtimes: [makeRuntime({ id: "rt-m1" })],
    ...overrides,
  } as DaemonMachineRead;
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "SillyHub",
    slug: "sillyhub",
    root_path: "C:/sillyhub",
    status: "active",
    ...overrides,
  } as Workspace;
}

function makeSession(
  overrides: Partial<AgentSessionRead> = {},
): AgentSessionRead {
  return {
    id: "s-1",
    runtime_id: "rt-m1",
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: null,
    config: null,
    agent_profile_id: null,
    llm_provider_id: null,
    config_snapshot: null,
    turn_count: 1,
    created_at: "2026-08-15T09:00:00Z",
    last_active_at: "2026-08-15T09:05:00Z",
    ended_at: null,
    title: "会话标题",
    deleted_at: null,
    current_run_id: null,
    ...overrides,
  } as AgentSessionRead;
}

function listResponse(items: AgentSessionRead[], extra: Partial<{ total: number }> = {}) {
  return {
    items,
    total: extra.total ?? items.length,
    limit: 50,
    offset: 0,
  };
}

/**
 * 2026-09-08-session-list-liveness-dot task-03：liveness 条目固件（最小
 * AgentLogListItem 字段子集——state 四字段 + agent_session_id 关联键）。
 */
function makeLivenessEntry(
  overrides: Partial<AgentLogListItem> = {},
): AgentLogListItem {
  return {
    id: "log-1",
    workspace_id: "ws-1",
    log_path: "C:/logs/agent.jsonl",
    harness: "zcode",
    exists: true,
    agent_session_id: "s-1",
    state: "working",
    state_derived_at: "2026-09-07T23:59:50Z",
    state_evidence: "tool_use 未配对 ×2",
    last_event_at: "2026-09-07T23:59:00Z",
    created_at: "2026-09-07T23:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    ...overrides,
  } as AgentLogListItem;
}

/** 清掉 liveness 转移检测/未读标记的 localStorage 键（跨用例隔离）。 */
function clearLivenessStorage() {
  for (const key of Object.keys(window.localStorage)) {
    if (
      key.startsWith("sillyhub:liveness-state:") ||
      key.startsWith("sillyhub:liveness-unread:") ||
      // 2026-10-15-session-status-dot-semantics：执行完成通知标记同清。
      key.startsWith("sillyhub:session-completed-unread:")
    ) {
      window.localStorage.removeItem(key);
    }
  }
}

/** 设置 useDaemonMachines 返回（默认成功空集）。 */
function setMachines(r: Partial<{ items: DaemonMachineRead[] }> = {}) {
  // machineCandidates 与 items 同源派生：面板机器小节/两层筛选已改读融合候选
  // （task-10，2026-08-28-daemon-agent-share），漏配机器层 tab 全空。
  const items = r.items ?? [];
  mocks.machinesHook.mockReturnValue({
    items,
    sharedToMe: [],
    machineCandidates: items,
    total: items.length,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mocks.machinesRefetch,
  });
}

/** 设置 listWorkspaces 返回（默认成功空集）。 */
function setWorkspaces(items: Workspace[] = []) {
  mocks.listWorkspaces.mockResolvedValue({
    items,
    total: items.length,
    limit: 100,
    offset: 0,
  });
}

function renderPanel(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

// ── antd Select / Segmented 触发助手（jsdom portal 语义） ────────────────

/** 打开 antd Select 下拉（v5/v6 DOM 兼容，经 id 锚定）。 */
function openAntdSelect(selectId: string) {
  const anchor = document.getElementById(selectId);
  if (!anchor) throw new Error(`element #${selectId} not found`);
  const root = anchor.classList.contains("ant-select")
    ? anchor
    : closestAntdSelect(anchor);
  if (!root) throw new Error(`.ant-select for #${selectId} not found`);
  const clickZone = queryAntdSelectZone(root);
  if (!clickZone) throw new Error(`select click zone for #${selectId} not found`);
  fireEvent.mouseDown(clickZone);
}

/** 点选 antd Select 下拉中含指定文本的选项（multiple 模式不自动关闭）。 */
async function chooseAntdOptionByText(selectId: string, optionText: string) {
  openAntdSelect(selectId);
  const option = await waitFor(() => {
    const hit = [
      ...document.querySelectorAll(".ant-select-item-option-content"),
    ].find((el) => el.textContent?.trim() === optionText);
    if (!hit) throw new Error(`option "${optionText}" not found`);
    return hit as HTMLElement;
  });
  const optionRow = closestAntdSelectOption(option) as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  await act(async () => {
    await Promise.resolve();
  });
}

/** 当前渲染的会话行（树内/平铺均为 role=button name=会话 …）。 */
function sessionRows(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: /^会话 / });
}

/** 展开工作区分组（ql-20260824-001 起默认全组折叠，点组头展开）。 */
async function openGroup(name: string) {
  const head = await screen.findByRole("button", {
    name: `工作区分组 ${name}`,
  });
  fireEvent.click(head);
  await waitFor(() => expect(head).toHaveAttribute("aria-expanded", "true"));
}

/** 组头 label 序列（断言分组顺序/存在性）。 */
function groupHeadLabels(): (string | null)[] {
  return screen
    .queryAllByRole("button", { name: /^工作区分组 / })
    .map((el) => el.getAttribute("aria-label"));
}

/** 机器小节标题（非表单元素，经 aria-label 直接锚定）。 */
function machineSection(label: string): Element | null {
  return document.querySelector(`[aria-label="机器小节 ${label}"]`);
}

function lastCallArgs(): Record<string, unknown> {
  const calls = mocks.listAgentSessions.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mocks.listAgentSessions.mockReset().mockResolvedValue(listResponse([]));
  // D-003@v2：两 scope 端点仅剩零调用断言用途
  mocks.listWorkspaceAgentSessions.mockReset().mockResolvedValue([]);
  mocks.listChangeSessions.mockReset().mockResolvedValue([]);
  // task-07：群分区默认成功空集（既有用例零渲染干扰）。
  mocks.listGroupChats.mockReset().mockResolvedValue([]);
  mocks.listWorkspaces.mockReset();
  // quick（ql-20260916-014）：my-bindings 默认成功空集（queryFn Promise.all 不挂）。
  mocks.fetchMyBindings.mockReset().mockResolvedValue([]);
  // task-10（X-009）：选项数据源默认成功空集（workspace scope 既有用例零干扰）。
  mocks.listChanges.mockReset().mockResolvedValue({ items: [], total: 0 });
  mocks.listQuicklogEntries.mockReset().mockResolvedValue({ items: [], total: 0 });
  // task-06（FR-05）：PPM 选项数据源默认成功空集 + 当前用户复位（真实 store，
  // setState 直写；persist 落 localStorage 不影响断言）。
  mocks.listPersonalPlanTasks
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  mocks.listProblems
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  useSession.setState({ user: null });
  setWorkspaces();
  setMachines();
  mocks.machinesRefetch.mockReset();
  // ql-20260824-002：展开记忆隔离（用户手动 toggle 落盘，跨用例须清）
  window.localStorage.removeItem(SESSION_TREE_EXPANSION_LS_KEY);
  // quick：群聊分区折叠记忆隔离（跨用例须清）。
  window.localStorage.removeItem(GROUP_SECTION_COLLAPSED_LS_KEY);
  // ql-20260908-005：两层筛选记忆隔离（选择落盘恢复，跨用例须清）。
  window.localStorage.removeItem(SESSION_TREE_FILTER_LS_KEY);
  // 2026-09-08-session-list-liveness-dot task-03：liveness 转移检测/未读标记
  // 隔离（默认空集——既有用例零渲染干扰）。
  clearLivenessStorage();
  mocks.listWorkspaceAgentLogs.mockReset().mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
});

/** 两台机器的标准固件（rt-m1/rt-m2 分别挂 machine-1/machine-2）。 */
function twoMachines() {
  return [
    makeMachine({
      id: "m-1",
      hostname: "machine-1",
      runtimes: [makeRuntime({ id: "rt-m1" })],
    }),
    makeMachine({
      id: "m-2",
      hostname: "machine-2",
      runtimes: [makeRuntime({ id: "rt-m2" })],
    }),
  ];
}

// ── 1. 全局树初次渲染（D-103 一次拉取 + 客户端分组） ─────────────────────

describe("SessionListPanel 全局树初次渲染", () => {
  it("默认一次拉取 limit=500；按 workspace_id 分组（可见会话数排序+构造序稳定，0 会话组沉底仍显示计数 0）", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "SillyHub" }),
      makeWorkspace({ id: "ws-2", name: "空工作区" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-a", workspace_id: "ws-1", title: "核对变更" }),
        makeSession({ id: "s-b", workspace_id: null, title: "临时问答" }),
      ]),
    );
    renderPanel(<SessionListPanel />);

    // ql-20260824-001 起默认全组折叠：以组头为数据到达锚点（计数在组头可见）
    await screen.findByRole("button", { name: "工作区分组 SillyHub" });
    // 数据层：一次拉取 limit=500（D-103），无过滤参
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 500, archived: false });

    // 分组顺序（ql-20260908-016）：有可见会话的组在前（保持构造序，非工作区
    // 含 1 条随非空组），0 会话组（空工作区）稳定沉底——原工作区列表序让空组
    // 霸占首屏。
    expect(groupHeadLabels()).toEqual([
      "工作区分组 SillyHub",
      "工作区分组 非工作区",
      "工作区分组 空工作区",
    ]);
    // 0 会话组仍显示（计数 0）；SillyHub 与非工作区各 1 条
    expect(screen.getByText("0 个会话")).toBeInTheDocument();
    expect(screen.getAllByText("1 个会话").length).toBe(2);
    // 头部总数
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });

  it("组内机器小节：机器名 + 在线状态；runtime 缺席回退 config_snapshot.machine_name", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-a", workspace_id: "ws-1", runtime_id: "rt-m1", title: "映射会话" }),
        // runtime 列表外的机器：回退快照 machine_name，无在线信息（离线渲染）
        makeSession({
          id: "s-b",
          workspace_id: "ws-1",
          runtime_id: "rt-gone",
          config_snapshot: {
            profile_name: null,
            provider_name: null,
            engine: null,
            machine_name: "DESKTOP-GONE",
            agent_name: null,
            model: null,
          },
          title: "快照机器会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    await screen.findByRole("button", { name: "会话 映射会话" });
    expect(machineSection("machine-1")).not.toBeNull();
    expect(machineSection("DESKTOP-GONE")).not.toBeNull();
    expect(machineSection("DESKTOP-GONE")?.textContent).toContain("（离线）");
  });
});

// ── 2. 条目 chips（含创建人 owner_name，D-108@v2） ────────────────────────

describe("SessionListPanel 树条目 chips", () => {
  it("chips 读快照：引擎/档案/供应商/轮数 + 创建人（owner_name 有值直显）；树形态不重复 📂/🖥 chips", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-1",
          workspace_id: "ws-1",
          title: "整理会议纪要",
          turn_count: 12,
          owner_name: "qinyi",
          last_active_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          config_snapshot: {
            profile_name: "知识经理",
            provider_name: "Kimi",
            engine: "claude",
            machine_name: "DESKTOP-2BN7FDC",
            agent_name: "Claude Code",
            model: null,
          },
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    const row = await screen.findByRole("button", { name: "会话 整理会议纪要" });
    expect(row.textContent).toContain("Claude");
    expect(row.textContent).toContain("qinyi");
    expect(row.textContent).toContain("知识经理");
    expect(row.textContent).toContain("Kimi");
    expect(row.textContent).toContain("12 轮");
    expect(row.textContent).toContain("5 分钟前");
    // 2026-10-15-session-status-dot-semantics：active 空闲（无活性数据）→
    // 行首留白——不再渲染「状态 active」灰点。
    expect(row.querySelector('[aria-label="异常失败"]')).toBeNull();
    expect(screen.queryByLabelText("正在执行")).toBeNull();
    // 树形态：工作区/机器信息由组头与小节承载，chips 不再重复
    expect(row.textContent).not.toContain("📂");
    expect(row.textContent).not.toContain("🖥");
  });

  it("owner_name 为 null（旧会话/无主）→ 创建人 chip 显 —（brownfield 兜底）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-old", workspace_id: "ws-1", owner_name: null, title: "旧会话" }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    const row = await screen.findByRole("button", { name: "会话 旧会话" });
    expect(row.textContent).toContain("—");
  });

  it("快照缺省回退：config_snapshot null → 引擎回退 session.provider，无档案/供应商 chips", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-old",
          workspace_id: "ws-1",
          runtime_id: "rt-m1",
          provider: "codex",
          config_snapshot: null,
          title: "旧会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    const row = await screen.findByRole("button", { name: "会话 旧会话" });
    expect(row.textContent).toContain("Codex");
    expect(row.textContent).not.toContain("未指定");
    expect(row.textContent).not.toContain("本机默认");
  });
});

// ── 3/4. 两层筛选下拉（D-107：纯视图过滤不进数据层；ql-20260908-005 胶囊→下拉） ──

describe("SessionListPanel 两层筛选下拉", () => {
  function mixedSessions() {
    return [
      makeSession({ id: "s-1", runtime_id: "rt-m1", provider: "claude", title: "机器一Claude" }),
      makeSession({ id: "s-2", runtime_id: "rt-m1", provider: "codex", title: "机器一Codex" }),
      makeSession({ id: "s-3", runtime_id: "rt-m2", provider: "claude", title: "机器二Claude" }),
    ];
  }

  it("默认仅机器层；选机器后出现智能体层并过滤条目；小节标题隐藏；零新增请求（纯视图）", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse(mixedSessions()));
    // selectedSessionId 所在组（非工作区桶）在筛选切换后保持展开（R-05 除当前组）
    renderPanel(<SessionListPanel selectedSessionId="s-3" />);
    await waitFor(() => expect(sessionRows().length).toBe(3));

    // 默认：仅机器层（无智能体下拉）
    expect(document.getElementById("slp-agent")).toBeNull();

    // 选 machine-2 → 仅其条目 + 智能体下拉出现 + 小节标题隐藏（FR-02）
    await chooseAntdOptionByText("slp-machine", "machine-2");
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(
      screen.queryByRole("button", { name: "会话 机器二Claude" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "会话 机器一Claude" }),
    ).not.toBeInTheDocument();
    expect(document.getElementById("slp-agent")).not.toBeNull();
    expect(machineSection("machine-2")).toBeNull(); // 筛选态隐藏机器小节标题

    // 纯视图过滤：不进数据层（调用次数不变）
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 500, archived: false });
  });

  it("智能体层过滤 codex；「全部」清空智能体；机器层「全部」清空并隐藏第二层", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse(mixedSessions()));
    // 同上：当前组（非工作区桶）保持展开
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);
    await waitFor(() => expect(sessionRows().length).toBe(3));

    // 选 machine-1 → 两条；再选 Codex → 仅 Codex
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await waitFor(() => expect(sessionRows().length).toBe(2));
    await chooseAntdOptionByText("slp-agent", "Codex");
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(
      screen.getByRole("button", { name: "会话 机器一Codex" }),
    ).toBeInTheDocument();

    // 智能体「全部智能体」清空
    await chooseAntdOptionByText("slp-agent", "全部智能体");
    await waitFor(() => expect(sessionRows().length).toBe(2));

    // 机器「全部机器」清空并隐藏第二层
    await chooseAntdOptionByText("slp-machine", "全部机器");
    await waitFor(() => expect(sessionRows().length).toBe(3));
    expect(document.getElementById("slp-agent")).toBeNull();
    expect(machineSection("machine-1")).not.toBeNull(); // 小节标题恢复
  });

  it("智能体下拉含全部支持引擎（pi/cursor，单一源 ql-20260908-007）：pi/cursor 会话可筛选", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", runtime_id: "rt-m1", provider: "claude", title: "机器一Claude" }),
        makeSession({ id: "s-4", runtime_id: "rt-m1", provider: "pi", title: "机器一Pi" }),
        makeSession({ id: "s-5", runtime_id: "rt-m1", provider: "cursor", title: "机器一Cursor" }),
      ]),
    );
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);
    await waitFor(() => expect(sessionRows().length).toBe(3));

    // 选 machine-1 → 三条全在；选 Pi → 仅 pi 条目
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await waitFor(() => expect(sessionRows().length).toBe(3));
    await chooseAntdOptionByText("slp-agent", "Pi");
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(
      screen.getByRole("button", { name: "会话 机器一Pi" }),
    ).toBeInTheDocument();

    // 切 Cursor → 仅 cursor 条目
    await chooseAntdOptionByText("slp-agent", "Cursor");
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(
      screen.getByRole("button", { name: "会话 机器一Cursor" }),
    ).toBeInTheDocument();
  });

  it("R-05：筛选切换重置展开态除当前组（selectedSessionId 所在组保持展开）", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "工作区一" }),
      makeWorkspace({ id: "ws-2", name: "工作区二" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", runtime_id: "rt-m1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-2", runtime_id: "rt-m1", title: "会话B" }),
      ]),
    );
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);
    // ql-20260824-001 起默认全组折叠，选中会话所在组豁免展开（恢复定位语义）
    await screen.findByRole("button", { name: "会话 会话A" });
    expect(screen.queryByRole("button", { name: "会话 会话B" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区二" }),
    ).toHaveAttribute("aria-expanded", "false");

    // 筛选变化：当前组（选中会话所在 ws-1）保持展开，ws-2 折叠
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "会话 会话B" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "会话 会话A" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区二" }),
    ).toHaveAttribute("aria-expanded", "false");

    // 组头点击可再展开（手风琴）
    fireEvent.click(screen.getByRole("button", { name: "工作区分组 工作区二" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "会话 会话B" })).toBeInTheDocument(),
    );
  });

  it("defaultExpandedWorkspaceId：仅该组展开，其余折叠（task-06 深链预展开预留）", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "工作区一" }),
      makeWorkspace({ id: "ws-2", name: "工作区二" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-2", title: "会话B" }),
      ]),
    );
    renderPanel(<SessionListPanel defaultExpandedWorkspaceId="ws-2" />);

    await screen.findByRole("button", { name: "工作区分组 工作区二" });
    // 初值经 effect 落地（数据到位后一次性设置），waitFor 等 DOM 收敛
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "工作区分组 工作区一" }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
    expect(screen.getByRole("button", { name: "工作区分组 工作区二" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "会话 会话B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "会话 会话A" })).not.toBeInTheDocument();
  });

  // ── ql-20260908-005：两层筛选值 localStorage 记忆（刷新恢复用户选择） ──

  it("选择落盘 localStorage：机器+智能体两层值成对写入；机器清空时 agent 一并清", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse(mixedSessions()));
    // selectedSessionId 锚定「非工作区」组豁免展开（默认全折叠下行可见）
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);
    await waitFor(() => expect(sessionRows().length).toBe(3));

    await chooseAntdOptionByText("slp-machine", "machine-1");
    await chooseAntdOptionByText("slp-agent", "Codex");
    expect(
      JSON.parse(
        window.localStorage.getItem(SESSION_TREE_FILTER_LS_KEY) ?? "{}",
      ),
    ).toEqual({ machineId: "m-1", agent: "codex" });

    // 机器切「全部机器」→ 第二层随清（pickMachine 语义），记忆同步为全空
    await chooseAntdOptionByText("slp-machine", "全部机器");
    expect(
      JSON.parse(
        window.localStorage.getItem(SESSION_TREE_FILTER_LS_KEY) ?? "{}",
      ),
    ).toEqual({ machineId: "", agent: "" });
  });

  it("刷新恢复：localStorage 预置记忆 → 初始即筛选态（过滤生效+智能体下拉出现+小节标题隐藏）", async () => {
    window.localStorage.setItem(
      SESSION_TREE_FILTER_LS_KEY,
      JSON.stringify({ machineId: "m-2", agent: "" }),
    );
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse(mixedSessions()));
    // s-3 是 machine-2 上的会话：恢复筛选后仍锚定所在组展开
    renderPanel(<SessionListPanel selectedSessionId="s-3" />);

    // 初始即为 machine-2 筛选态：仅 1 条 + 智能体下拉在 + 机器小节标题隐藏
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(document.getElementById("slp-agent")).not.toBeNull();
    expect(machineSection("machine-2")).toBeNull();
  });

  it("陈旧机器 id 兜底：记忆中的机器已不在列表 → 机器列表到位后重置两层筛选", async () => {
    window.localStorage.setItem(
      SESSION_TREE_FILTER_LS_KEY,
      JSON.stringify({ machineId: "m-gone", agent: "codex" }),
    );
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse(mixedSessions()));
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);

    // 机器列表到位后兜底 effect 重置：全部条目可见 + 智能体下拉消失 + 记忆清
    await waitFor(() => expect(sessionRows().length).toBe(3));
    await waitFor(() => expect(document.getElementById("slp-agent")).toBeNull());
    expect(
      JSON.parse(
        window.localStorage.getItem(SESSION_TREE_FILTER_LS_KEY) ?? "{}",
      ),
    ).toEqual({ machineId: "", agent: "" });
  });

  it("坏数据容错：localStorage 存垃圾 JSON → 静默回未筛默认", async () => {
    window.localStorage.setItem(SESSION_TREE_FILTER_LS_KEY, "{oops");
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse(mixedSessions()));
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);

    await waitFor(() => expect(sessionRows().length).toBe(3));
    expect(document.getElementById("slp-agent")).toBeNull();
  });
});

// ── 5. 状态下拉 + 标题搜索（X-11 保留：视图过滤不进数据层） ───────────────

describe("SessionListPanel 状态与搜索（树形态视图过滤）", () => {
  it("状态下拉选「已结束」→ 仅 ended 条目；零新增请求", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", status: "active", title: "活跃会话" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", status: "ended", title: "结束会话" }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await waitFor(() => expect(sessionRows().length).toBe(2));

    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(screen.getByRole("button", { name: "会话 结束会话" })).toBeInTheDocument();
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);

    // 切回全部状态
    await chooseAntdOptionByText("slp-status", "全部状态");
    await waitFor(() => expect(sessionRows().length).toBe(2));
  });

  it("归档三态回归（quick 风险审查修）：默认/状态视图显式 archived=false，仅「已归档会话」传 true", async () => {
    // 后端 archived 三态化后 HTTP 默认 None=全部含已归档（ql-20260831-015）——
    // 桌面列表此前非归档视图不传参，归档会话混入默认列表与状态筛选（与弹窗
    // 文案「归档后将从默认列表隐藏」矛盾）。移动端/机器列表均已显式 false。
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));
    expect(lastCallArgs().archived).toBe(false);

    // 状态筛选视图同样只看未归档。
    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() => expect(lastCallArgs().archived).toBe(false));

    // 归档视图才请求已归档。
    await chooseAntdOptionByText("slp-status", "已归档会话");
    await waitFor(() => expect(lastCallArgs().archived).toBe(true));
  });

  it("标题搜索：回车才应用（视图过滤）；仅输入不生效", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "整理会议纪要" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", title: "扫描文档" }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await waitFor(() => expect(sessionRows().length).toBe(2));

    const input = screen.getByLabelText("搜索会话标题");
    fireEvent.change(input, { target: { value: "会议" } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sessionRows().length).toBe(2); // 输入不生效

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(screen.getByRole("button", { name: "会话 整理会议纪要" })).toBeInTheDocument();
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1); // 视图过滤零请求
  });
});

// ── 5b. 筛选态条目信息去冗余（ql-20260823-003） ────────────────────────────

describe("SessionListPanel 筛选后条目去冗余（ql-20260823-003）", () => {
  it("筛选智能体后条目隐藏引擎 chip（全部同引擎，冗余）；清空恢复", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    const row = await screen.findByRole("button", { name: "会话 会话A" });
    expect(row.textContent).toContain("Claude"); // 未筛选：引擎 chip 在

    // R-05：筛选切换重置展开态（无选中会话 → 全组折叠），断言前先重新展开组
    const groupHead = () =>
      screen.getByRole("button", { name: "工作区分组 SillyHub" });
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await chooseAntdOptionByText("slp-agent", "Claude Code");
    fireEvent.click(groupHead());
    await waitFor(() => {
      const filtered = screen.getByRole("button", { name: "会话 会话A" });
      expect(filtered.textContent).not.toContain("Claude"); // 筛选后隐藏
    });

    await chooseAntdOptionByText("slp-machine", "全部机器");
    fireEvent.click(groupHead());
    await waitFor(() => {
      const restored = screen.getByRole("button", { name: "会话 会话A" });
      expect(restored.textContent).toContain("Claude"); // 清空恢复
    });
  });
});

// ── 6. 组头交互 + 截断（R-03） ────────────────────────────────────────────

describe("SessionListPanel 组头回调与截断", () => {
  it("组头「＋」→ onNewInGroup(workspaceId, 筛选快照)；非工作区组「＋」→ onNewInGroup(null, …)（D-105；ql-20260823-001 二参）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: null, title: "临时问答" }),
      ]),
    );
    const onNewInGroup = vi.fn();
    renderPanel(<SessionListPanel onNewInGroup={onNewInGroup} />);

    // 默认折叠下组头「＋」仍在 DOM（opacity 隐藏不影响测试点击）
    fireEvent.click(
      await screen.findByRole("button", { name: "在 SillyHub 新建会话" }),
    );
    // ql-20260823-001：未筛选时筛选快照为空串（两层均未选）。
    expect(onNewInGroup).toHaveBeenCalledWith("ws-1", {
      machineId: "",
      agent: "",
    });

    fireEvent.click(screen.getByRole("button", { name: "在 非工作区 新建会话" }));
    expect(onNewInGroup).toHaveBeenCalledWith(null, { machineId: "", agent: "" });
    expect(onNewInGroup).toHaveBeenCalledTimes(2);
  });

  it("ql-20260829-010：归档工作区组头「＋」置灰（点击不触发 onNewInGroup）；活跃组不受影响", async () => {
    setWorkspaces([
      makeWorkspace({ id: "ws-on", name: "活跃区" }),
      makeWorkspace({ id: "ws-off", name: "归档区", status: "archived" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-on", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-off", title: "会话B" }),
      ]),
    );
    const onNewInGroup = vi.fn();
    renderPanel(<SessionListPanel onNewInGroup={onNewInGroup} />);

    // 归档组「＋」disabled + title 提示恢复路径
    const archivedBtn = await screen.findByRole("button", {
      name: "在 归档区 新建会话",
    });
    expect(archivedBtn).toBeDisabled();
    expect(archivedBtn).toHaveAttribute(
      "title",
      expect.stringContaining("已归档"),
    );
    fireEvent.click(archivedBtn);

    // 活跃组「＋」正常触发
    fireEvent.click(
      screen.getByRole("button", { name: "在 活跃区 新建会话" }),
    );
    expect(onNewInGroup).toHaveBeenCalledTimes(1);
    expect(onNewInGroup).toHaveBeenCalledWith("ws-on", {
      machineId: "",
      agent: "",
    });
  });

  it("筛选态（机器+智能体均已选）点组头「＋」→ 回调携带具体筛选值（D-107 直带链前提）", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    const onNewInGroup = vi.fn();
    renderPanel(<SessionListPanel onNewInGroup={onNewInGroup} />);

    // 默认折叠下组头「＋」仍在 DOM；两层筛选：机器 machine-1 → 智能体 Claude Code
    await screen.findByRole("button", { name: "在 SillyHub 新建会话" });
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await chooseAntdOptionByText("slp-agent", "Claude Code");
    fireEvent.click(screen.getByRole("button", { name: "在 SillyHub 新建会话" }));
    expect(onNewInGroup).toHaveBeenCalledWith("ws-1", {
      machineId: "m-1",
      agent: "claude",
    });
  });

  it("组内默认收敛（最新 10 ∪ 在线全显）+ 递增加载（每次 +20 覆盖全量后按钮消失）（R-03/FR-03；2026-10-28 递增语义改写）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    // 12 条已结束在前 + 5 条在线在后（服务端序）：默认 = 前 10 + 尾部在线
    // 全显 = 15 行；「加载更多」+20 覆盖 10+20≥17 → 全量 17 行且按钮消失。
    const many = [
      ...Array.from({ length: 12 }, (_, i) =>
        makeSession({
          id: `s-e-${i}`,
          workspace_id: "ws-1",
          title: `历史会话${i}`,
          status: "ended",
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeSession({
          id: `s-a-${i}`,
          workspace_id: "ws-1",
          title: `在线会话${i}`,
          status: "active",
        }),
      ),
    ];
    mocks.listAgentSessions.mockResolvedValue(listResponse(many));
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    await waitFor(() => expect(sessionRows().length).toBe(15));
    const moreBtn = screen.getByRole("button", { name: /加载更多/ });
    expect(moreBtn.textContent).toContain("还有 2 条");

    fireEvent.click(moreBtn);
    await waitFor(() => expect(sessionRows().length).toBe(17));
    // 全量覆盖后按钮消失（FR-03）。
    expect(
      screen.queryByRole("button", { name: /加载更多（还有/ }),
    ).not.toBeInTheDocument();
  });

  it("组内 35 条（在线 2 条在第 21/31 位）：加载更多每次恰好 +20 条此前隐藏行至全量（loadmore-fetch 预算计数语义）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const many = Array.from({ length: 35 }, (_, i) =>
      makeSession({
        id: `s-${i}`,
        workspace_id: "ws-1",
        title: `会话${i}`,
        status: i === 20 || i === 30 ? "active" : "ended",
      }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(many));
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    // 默认 = 最新 10 ∪ 在线 2 = 12 行。
    await waitFor(() => expect(sessionRows().length).toBe(12));
    // +20（预算计数：非默认条目按序消耗，恰好新增 20 条隐藏行）→ 32 行，
    // 仍隐藏 3 条（35-32）→ 按钮在场「还有 3 条」。
    fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
    await waitFor(() => expect(sessionRows().length).toBe(32));
    expect(screen.getByRole("button", { name: /加载更多/ }).textContent).toContain(
      "还有 3 条",
    );
    // 再 +20 → 覆盖全量 35，按钮消失。
    fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
    await waitFor(() => expect(sessionRows().length).toBe(35));
    expect(
      screen.queryByRole("button", { name: /加载更多（还有/ }),
    ).not.toBeInTheDocument();
  });
});

// ── 2026-10-28-session-list-refresh-and-paging：总数常显 / 数据层续拉 / 重置 ──

describe("SessionListPanel 总数常显与数据层加载更多（session-list-refresh-and-paging）", () => {
  it("FR-02：总数常显「共 N 条会话」；已加载不足时附已加载计数 + FR-04 数据层入口在场", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const loaded = Array.from({ length: 3 }, (_, i) =>
      makeSession({ id: `s-${i}`, workspace_id: "ws-1", title: `会话${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(
      listResponse(loaded, { total: 800 }),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    await waitFor(() =>
      expect(screen.getByText(/共 800 条会话/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/已加载 3 条/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "加载更多会话" }),
    ).toBeInTheDocument();
  });

  it("FR-02 零回归锚：已加载 = 总数时只显总数（无已加载计数、无数据层入口）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    await waitFor(() =>
      expect(screen.getByText(/共 1 条会话$/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/已加载/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加载更多会话" }),
    ).not.toBeInTheDocument();
  });

  it("FR-04/03：点「加载更多会话」→ offset 续拉（同筛选参，每次 20 条）+ 附加段去重后追加展示", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const first = Array.from({ length: 2 }, (_, i) =>
      makeSession({ id: `s-${i}`, workspace_id: "ws-1", title: `会话${i}` }),
    );
    // 续拉页：1 条与首屏重叠（排序漂移模拟）+ 2 条新会话 → 去重后 +2。
    const second = [
      makeSession({ id: "s-0", workspace_id: "ws-1", title: "会话0" }),
      makeSession({ id: "s-10", workspace_id: "ws-1", title: "新会话10" }),
      makeSession({ id: "s-11", workspace_id: "ws-1", title: "新会话11" }),
    ];
    mocks.listAgentSessions
      .mockResolvedValueOnce(listResponse(first, { total: 4 }))
      .mockResolvedValueOnce(listResponse(second, { total: 4 }));
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await waitFor(() => expect(sessionRows().length).toBe(2));

    fireEvent.click(screen.getByRole("button", { name: "加载更多会话" }));
    await waitFor(() => expect(sessionRows().length).toBe(4));
    // 续拉请求：offset=首屏已加载数（游标基线）、limit=20（每次 20 条，用户拍板）。
    const secondCall = mocks.listAgentSessions.mock.calls[1]![0] as Record<
      string,
      unknown
    >;
    expect(secondCall.offset).toBe(2);
    expect(secondCall.limit).toBe(20);
    // 去重后已加载 = 4 = total → 数据层入口消失。
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "加载更多会话" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("FR-02：组内「加载更多」点击并行触网续拉（offset=首屏条数 limit=20）；全部拉完后再点不再发请求", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    // 首屏 3 条（10 基线内全显、组内无隐藏行）+ 服务端 total=5：组内本无
    // 「加载更多」按钮（无隐藏），用数据层入口先触发？——不行，本用例要点
    // **组内**按钮：改用首屏 12 条（2 条隐藏）+ total=14（续拉页 2 条新会话）。
    const first = [
      ...Array.from({ length: 12 }, (_, i) =>
        makeSession({
          id: `s-${i}`,
          workspace_id: "ws-1",
          title: `会话${i}`,
          status: "ended",
        }),
      ),
    ];
    const secondPage = [
      makeSession({ id: "s-20", workspace_id: "ws-1", title: "续拉会话20" }),
      makeSession({ id: "s-21", workspace_id: "ws-1", title: "续拉会话21" }),
    ];
    mocks.listAgentSessions
      .mockResolvedValueOnce(listResponse(first, { total: 14 }))
      .mockResolvedValue(listResponse(secondPage, { total: 14 }));
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    // 默认 10 行、组内隐藏 2 条 → 按钮在场。
    await waitFor(() => expect(sessionRows().length).toBe(10));
    const groupMore = screen.getByRole("button", { name: /加载更多（还有/ });

    // 点击：本地 +20 展开（12 全显）+ 并行触网（offset=首屏 12 条, limit=20）。
    fireEvent.click(groupMore);
    await waitFor(() => expect(sessionRows().length).toBe(12));
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    const fetchCall = mocks.listAgentSessions.mock.calls[1]![0] as Record<
      string,
      unknown
    >;
    expect(fetchCall.offset).toBe(12);
    expect(fetchCall.limit).toBe(20);
    // 续拉 2 条追加进组（10 基线外共 4 隐藏 → 已全显 12+2=14 = total）。
    await waitFor(() => expect(sessionRows().length).toBe(14));

    // 已加载 = total → 再点组内按钮（若在场）不再发请求；此处已全显按钮消失，
    // 用调用次数稳定断言（无第三次请求）。
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: /加载更多（还有/ }),
    ).not.toBeInTheDocument();
  });

  it("FR-05：两层筛选切换 → 组内递增计数重置回默认基线", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    // 15 条 ended（无在线）→ 默认 10，加载一次 +20 → 15 全量。
    const many = Array.from({ length: 15 }, (_, i) =>
      makeSession({
        id: `s-${i}`,
        workspace_id: "ws-1",
        title: `会话${i}`,
        status: "ended",
      }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(many));
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await waitFor(() => expect(sessionRows().length).toBe(10));
    fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
    await waitFor(() => expect(sessionRows().length).toBe(15));

    // 切换机器筛选 → resetExpansionForFilter → 组内递增清零 + 组折叠收纳
    // （R-05 重置语义），重新展开组后回默认 10 行。
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await openGroup("SillyHub");
    await waitFor(() => expect(sessionRows().length).toBe(10));
    expect(
      screen.getByRole("button", { name: /加载更多/ }),
    ).toBeInTheDocument();
  });
});

// ── 7. 点击回调 / 空态 / 错误态 ───────────────────────────────────────────

describe("SessionListPanel 点击与选中态", () => {
  it("点击条目 → onSelect 回调带完整 session；selectedSessionId 对应行 aria-pressed=true", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", title: "会话B" }),
      ]),
    );
    const onSelect = vi.fn();
    renderPanel(<SessionListPanel selectedSessionId="s-1" onSelect={onSelect} />);

    const rowB = await screen.findByRole("button", { name: "会话 会话B" });
    const rowA = screen.getByRole("button", { name: "会话 会话A" });
    expect(rowA).toHaveAttribute("aria-pressed", "true");
    expect(rowB).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(rowB);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "s-2" });
  });
});

describe("SessionListPanel 批量与单条删除（组头尾随多选入口）", () => {
  it("组头「多选」→ 勾选条目 → 删除选中回调 ids；全选本组", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", title: "会话B" }),
      ]),
    );
    const onDeleteSessions = vi.fn().mockResolvedValue(undefined);
    renderPanel(<SessionListPanel onDeleteSessions={onDeleteSessions} />);
    await openGroup("SillyHub");

    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "多选 SillyHub" }));
    // 多选态：点行 = 勾选（不触发 onSelect）
    fireEvent.click(screen.getByRole("button", { name: "会话 会话A" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /删除选中（1）/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "全选本组" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /删除选中（2）/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /删除选中（2）/ }));
    fireEvent.click(await screen.findByRole("button", { name: "删除 2 个" }));
    await waitFor(() =>
      expect(onDeleteSessions).toHaveBeenCalledWith(["s-1", "s-2"]),
    );
  });

  it("单条删除：hover 删除按钮 → 确认 → onDeleteSessions([id])", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    const onDeleteSessions = vi.fn().mockResolvedValue(undefined);
    renderPanel(<SessionListPanel onDeleteSessions={onDeleteSessions} />);
    await openGroup("SillyHub");

    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话A" }));
    // Modal.confirm 确认按钮（okText「删除」两字，antd 自动插空格影响可访问名，
    // 经危险按钮类锚定）
    const okBtn = await waitFor(() => {
      const btn = document.querySelector(
        ".ant-modal-confirm-btns .ant-btn-primary",
      ) as HTMLElement | null;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
    fireEvent.click(okBtn);
    await waitFor(() => expect(onDeleteSessions).toHaveBeenCalledWith(["s-1"]));
  });

  it("删除结果 toast（ql-20260903-019）：回调返回失败个数 → warning 提示，不再零反馈", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    const onDeleteSessions = vi.fn().mockResolvedValue(1);
    renderPanel(<SessionListPanel onDeleteSessions={onDeleteSessions} />);
    await openGroup("SillyHub");

    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话A" }));
    const okBtn = await waitFor(() => {
      const btn = document.querySelector(
        ".ant-modal-confirm-btns .ant-btn-primary",
      ) as HTMLElement | null;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
    fireEvent.click(okBtn);
    await waitFor(() => expect(onDeleteSessions).toHaveBeenCalledWith(["s-1"]));
    // 部分失败：warning 带失败个数；成功分支不触发。
    await waitFor(() =>
      expect(notifyMocks.warning).toHaveBeenCalledWith(
        expect.stringContaining("请重试"),
      ),
    );
    expect(notifyMocks.success).not.toHaveBeenCalledWith("会话已删除");
  });
});

// ── ql-20260831-013：归档 UX 重做 ─────────────────────────────────────────
// 行按钮按 archived_at 二选一（原两按钮无条件齐显）+ 已归档徽标 + 归档视图
// 横幅 + 操作结果 toast（成功/部分失败）。回调契约：返回失败个数。
describe("SessionListPanel 归档 UX（ql-20260831-013）", () => {
  it("未归档行：只显示「归档」按钮，无「取消归档」无徽标", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    renderPanel(
      <SessionListPanel
        onArchiveSessions={vi.fn().mockResolvedValue(0)}
        onUnarchiveSessions={vi.fn().mockResolvedValue(0)}
      />,
    );
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 会话A" });
    expect(screen.getByRole("button", { name: "归档 会话A" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消归档 会话A" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("已归档")).not.toBeInTheDocument();
  });

  it("已归档行：只显示「取消归档」+「已归档」徽标（含归档时间 title）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-2",
          workspace_id: "ws-1",
          title: "会话B",
          archived_at: "2026-08-30T10:00:00Z",
        }),
      ]),
    );
    renderPanel(
      <SessionListPanel
        onArchiveSessions={vi.fn().mockResolvedValue(0)}
        onUnarchiveSessions={vi.fn().mockResolvedValue(0)}
      />,
    );
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 会话B" });
    expect(
      screen.getByRole("button", { name: "取消归档 会话B" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "归档 会话B" }),
    ).not.toBeInTheDocument();
    const badge = screen.getByText("已归档");
    expect(badge.closest("span")?.getAttribute("title")).toContain("已归档（");
  });

  it("归档视图（状态筛选「已归档会话」）：顶部上下文横幅 + 服务端 archived 参数", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-2",
          workspace_id: "ws-1",
          title: "会话B",
          archived_at: "2026-08-30T10:00:00Z",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 会话B" });
    expect(screen.queryByText(/正在查看已归档会话/)).not.toBeInTheDocument();
    await chooseAntdOptionByText("slp-status", "已归档会话");
    expect(screen.getByText(/正在查看已归档会话（1 个）/)).toBeInTheDocument();
    await waitFor(() => {
      // 哨兵值触发服务端过滤参 archived=true（2026-08-24 既有行为，回归护栏）
      const lastCall =
        mocks.listAgentSessions.mock.calls[
          mocks.listAgentSessions.mock.calls.length - 1
        ];
      expect(lastCall?.[0]).toMatchObject({ archived: true });
    });
  });

  it("归档确认成功 → toast 指引去「已归档会话」筛选；部分失败 → warning", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" })]),
    );
    const onArchiveSessions = vi.fn().mockResolvedValue(0);
    renderPanel(<SessionListPanel onArchiveSessions={onArchiveSessions} />);
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "归档 会话A" }));
    const okBtn = await waitFor(() => {
      const btn = document.querySelector(
        ".ant-modal-confirm-btns .ant-btn-primary",
      ) as HTMLElement | null;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
    fireEvent.click(okBtn);
    await waitFor(() =>
      expect(onArchiveSessions).toHaveBeenCalledWith(["s-1"]),
    );
    await waitFor(() =>
      expect(notifyMocks.success).toHaveBeenCalledWith(
        "已归档「会话A」，可在筛选「已归档会话」中查看",
      ),
    );
    // 部分失败口径：回调返回失败个数 → warning（toast 不误报成功）
    onArchiveSessions.mockResolvedValue(1);
    fireEvent.click(screen.getByRole("button", { name: "归档 会话A" }));
    const okBtn2 = await waitFor(() => {
      const btns = document.querySelectorAll(
        ".ant-modal-confirm-btns .ant-btn-primary",
      );
      const btn = btns[btns.length - 1] as HTMLElement | undefined;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
    fireEvent.click(okBtn2);
    await waitFor(() =>
      expect(notifyMocks.warning).toHaveBeenCalledWith(
        expect.stringContaining("1 个失败"),
      ),
    );
  });
});

describe("SessionListPanel 空态与错误态（树形态）", () => {
  it("无会话 → 非工作区空组仍在 + 无匹配提示", async () => {
    setWorkspaces([]);
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel />);
    await waitFor(() =>
      expect(screen.getByText("没有符合条件的会话")).toBeInTheDocument(),
    );
    // 全局形态：非工作区固定末尾组（0 会话仍显示）
    expect(groupHeadLabels()).toEqual(["工作区分组 非工作区"]);
    expect(sessionRows().length).toBe(0);
  });

  it("查询失败 → 错误条 + 重新加载恢复", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.listAgentSessions.mockRejectedValue(
      new ApiError(500, {
        code: "INTERNAL",
        message: "服务器开小差",
        request_id: null,
        details: null,
      }),
    );
    renderPanel(<SessionListPanel />);
    await waitFor(() =>
      expect(screen.getByText(/加载会话失败：服务器开小差/)).toBeInTheDocument(),
    );

    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() =>
      expect(screen.getByText("没有符合条件的会话")).toBeInTheDocument(),
    );
  });
});

// ── 8. scope 用例（D-003@v2：workspace=树单组 / change=现状平铺） ─────────

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
  qlId: "ql-20260825-001",
};
const RUNTIME_SCOPE: SessionListScope = { kind: "runtime", runtimeId: "rt-1" };

describe("SessionListPanel workspace scope（树单组，端点过滤维持）", () => {
  it("listAgentSessions 带 {limit:500, workspace_id}；仅渲染该工作区单组；v2 两 scope 端点零调用", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "SillyHub" }),
      makeWorkspace({ id: "ws-2", name: "其它工作区" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-ws", workspace_id: "ws-1", title: "工作区会话" })]),
    );
    renderPanel(
      <SessionListPanel scope={WORKSPACE_SCOPE} defaultExpandedWorkspaceId="ws-1" />,
    );

    await screen.findByRole("button", { name: "会话 工作区会话" });
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 500, archived: false, workspace_id: "ws-1" });
    // 单组：仅该工作区分组（非工作区组不渲染——数据已被端点过滤）
    expect(groupHeadLabels()).toEqual(["工作区分组 SillyHub"]);
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();
  });

  it("他人会话由端点过滤：mock 返回什么显示什么（客户端零过滤）+ 全字段 chips 渲染", async () => {
    setMachines({ items: [] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-full",
          workspace_id: "ws-1",
          user_id: "u-me",
          title: "全字段会话",
          owner_name: "qinyi",
          config_snapshot: {
            profile_name: "知识经理",
            provider_name: "Kimi",
            engine: "claude",
            machine_name: "DESKTOP-2BN7FDC",
            model: null,
            agent_name: null,
          },
          last_active_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          turn_count: 7,
        }),
        makeSession({
          id: "s-other",
          workspace_id: "ws-1",
          user_id: "u-other",
          title: "同事的会话",
        }),
      ]),
    );
    renderPanel(
      <SessionListPanel scope={WORKSPACE_SCOPE} defaultExpandedWorkspaceId="ws-1" />,
    );

    const row = await screen.findByRole("button", { name: "会话 全字段会话" });
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeInTheDocument();
    // 全字段 chips（D-003@v2：全局端点返回全字段，树形态照常渲染）
    expect(row.textContent).toContain("Claude");
    expect(row.textContent).toContain("qinyi");
    expect(row.textContent).toContain("知识经理");
    expect(row.textContent).toContain("Kimi");
    expect(row.textContent).toContain("7 轮");
    expect(row.textContent).toContain("5 分钟前");
    // 机器名经快照回退落小节标题（机器列表留空证明不依赖映射）
    expect(machineSection("DESKTOP-2BN7FDC")).not.toBeNull();
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });
});

describe("SessionListPanel change scope（ql-20260823-003：同走工作区树，D-106 修订）", () => {
  it("数据源：{limit:500, workspace_id, change_id} 双传；树单组渲染 + 组头「＋」在；平铺控件（引擎 Segmented/机器多选/加载更多）退役", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-chg", workspace_id: "ws-1", title: "变更会话" })]),
    );
    renderPanel(
      <SessionListPanel
        scope={CHANGE_SCOPE}
        defaultExpandedWorkspaceId="ws-1"
        onNewInGroup={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "会话 变更会话" }),
    ).toBeInTheDocument();
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({
      limit: 500,
      archived: false,
      workspace_id: "ws-1",
      change_id: "chg-1",
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();
    // 树形态：单组分组头 + 组头「＋」（新建经门户双传 change 上下文）；
    // mock workspaces 命中 → 组名解析为 SillyHub。
    expect(groupHeadLabels()).toEqual(["工作区分组 SillyHub"]);
    expect(
      screen.getByRole("button", { name: "在 SillyHub 新建会话" }),
    ).toBeInTheDocument();
    // 平铺控件退役（引擎胶囊/机器多选/加载更多）。机器筛选用例 ql-20260908-005
    // 起为树下拉（#slp-machine 单选形态）——退役守卫锚定多选形态而非 id。
    expect(queryAntdSegmented()).toBeNull();
    expect(queryAntdSelectMultiple(document)).toBeNull();
    expect(screen.queryByRole("button", { name: /加载更多/ })).toBeNull();
  });

  it("树形态筛选纯视图过滤：状态客户端过滤零请求", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "活跃的", status: "active" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", title: "已结束的", status: "ended" }),
      ]),
    );
    renderPanel(
      <SessionListPanel scope={CHANGE_SCOPE} defaultExpandedWorkspaceId="ws-1" />,
    );
    await screen.findByRole("button", { name: "会话 活跃的" });
    const calls = mocks.listAgentSessions.mock.calls.length;

    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "会话 活跃的" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "会话 已结束的" })).toBeInTheDocument();
    expect(mocks.listAgentSessions.mock.calls.length).toBe(calls); // 零请求
  });

  it("搜索客户端过滤：回车后按标题过滤可见条目（零请求）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会议纪要" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", title: "部署手册" }),
      ]),
    );
    renderPanel(
      <SessionListPanel scope={CHANGE_SCOPE} defaultExpandedWorkspaceId="ws-1" />,
    );
    await screen.findByRole("button", { name: "会话 会议纪要" });
    const calls = mocks.listAgentSessions.mock.calls.length;

    const input = screen.getByLabelText("搜索会话标题");
    fireEvent.change(input, { target: { value: "会议" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "会话 部署手册" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "会话 会议纪要" })).toBeInTheDocument();
    expect(mocks.listAgentSessions.mock.calls.length).toBe(calls); // 零请求
  });

  it("他人会话由端点过滤：mock 返回什么显示什么（客户端零过滤）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-own", workspace_id: "ws-1", user_id: "u-me", title: "我的会话" }),
        makeSession({
          id: "s-other",
          workspace_id: "ws-1",
          user_id: "u-other",
          title: "同事的会话",
        }),
      ]),
    );
    renderPanel(
      <SessionListPanel scope={CHANGE_SCOPE} defaultExpandedWorkspaceId="ws-1" />,
    );

    expect(
      await screen.findByRole("button", { name: "会话 我的会话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeInTheDocument();
  });
});

// ── 9. 分组默认折叠 + 本地 Agent 合并小节（ql-20260824-001） ────────────────

describe("SessionListPanel 分组默认折叠与本地 Agent 小节（ql-20260824-001）", () => {
  /** tool_report 固件：origin=tool_report（SillySpec CLI 自动上报，本地 Agent）。 */
  function makeToolSession(
    overrides: Partial<AgentSessionRead> = {},
  ): AgentSessionRead {
    return makeSession({
      origin: "tool_report",
      runtime_id: null,
      config_snapshot: {
        profile_name: null,
        provider_name: null,
        engine: null,
        machine_name: "machine-1",
        agent_name: null,
        model: null,
      },
      ...overrides,
    });
  }

  it("无选中初态：全组默认折叠（组头 aria-expanded=false，条目不渲染）；点组头展开", async () => {
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "工作区一" }),
      makeWorkspace({ id: "ws-2", name: "工作区二" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-2", title: "会话B" }),
      ]),
    );
    renderPanel(<SessionListPanel />);

    await screen.findByRole("button", { name: "工作区分组 工作区一" });
    for (const name of ["工作区一", "工作区二", "非工作区"]) {
      expect(
        screen.getByRole("button", { name: `工作区分组 ${name}` }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    expect(
      screen.queryByRole("button", { name: "会话 会话A" }),
    ).not.toBeInTheDocument();

    await openGroup("工作区一");
    expect(
      screen.getByRole("button", { name: "会话 会话A" }),
    ).toBeInTheDocument();
  });

  it("选中会话所在组默认展开（刷新/深链恢复 ?session= 的定位语义），其余组折叠", async () => {
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "工作区一" }),
      makeWorkspace({ id: "ws-2", name: "工作区二" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-2", title: "会话B" }),
      ]),
    );
    renderPanel(<SessionListPanel selectedSessionId="s-2" />);

    expect(
      await screen.findByRole("button", { name: "会话 会话B" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "会话 会话A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区一" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("tool_report 会话合并进组内「本地 Agent」小节：不进机器分桶、默认折叠、展开可见", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-normal",
          workspace_id: "ws-1",
          runtime_id: "rt-m1",
          title: "正常会话",
        }),
        makeToolSession({
          id: "s-tool",
          workspace_id: "ws-1",
          title: "CLI 上报的会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    // tool_report 不进机器分桶（机器小节只含正常会话）
    expect(machineSection("machine-1")).not.toBeNull();
    expect(machineSection("machine-1")?.textContent).not.toContain("CLI 上报的会话");
    // 「本地 Agent」小节头：默认折叠 + 折叠态计数可见
    const toolHead = screen.getByRole("button", { name: "本地 Agent 小节" });
    expect(toolHead).toHaveAttribute("aria-expanded", "false");
    expect(toolHead.textContent).toContain("1 个会话");
    expect(
      screen.queryByRole("button", { name: "会话 CLI 上报的会话" }),
    ).not.toBeInTheDocument();

    // 点小节头展开 → 条目可见
    fireEvent.click(toolHead);
    await waitFor(() => expect(toolHead).toHaveAttribute("aria-expanded", "true"));
    expect(
      screen.getByRole("button", { name: "会话 CLI 上报的会话" }),
    ).toBeInTheDocument();
  });

  it("选中会话是 tool_report → 所在组 + 「本地 Agent」小节默认展开（恢复定位）", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-normal",
          workspace_id: "ws-1",
          runtime_id: "rt-m1",
          title: "正常会话",
        }),
        makeToolSession({
          id: "s-tool",
          workspace_id: "ws-1",
          title: "CLI 上报的会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel selectedSessionId="s-tool" />);

    expect(
      await screen.findByRole("button", { name: "会话 CLI 上报的会话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 Agent 小节" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("R-05：筛选变化重置「本地 Agent」小节展开态（与组级重置同语义）", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-normal",
          workspace_id: "ws-1",
          runtime_id: "rt-m1",
          title: "正常会话",
        }),
        makeToolSession({
          id: "s-tool",
          workspace_id: "ws-1",
          // 挂 runtime 使其通过 machine-1 tab 筛选（默认机器 runtime id=rt-m1；
          // 分桶不受影响——tool_report 恒落「本地 Agent」小节）。
          runtime_id: "rt-m1",
          title: "CLI 上报的会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    fireEvent.click(screen.getByRole("button", { name: "本地 Agent 小节" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "会话 CLI 上报的会话" }),
      ).toBeInTheDocument(),
    );

    // 机器筛选切换 → R-05 重置：组与小节都回默认折叠
    await chooseAntdOptionByText("slp-machine", "machine-1");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "会话 CLI 上报的会话" }),
      ).not.toBeInTheDocument(),
    );
    await openGroup("SillyHub");
    expect(
      screen.getByRole("button", { name: "本地 Agent 小节" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

// ── 10. 展开状态 localStorage 记忆（ql-20260824-002） ───────────────────────

describe("SessionListPanel 展开状态 localStorage 记忆（ql-20260824-002）", () => {
  /** 两组各一条会话的标准固件（工作区一=A / 工作区二=B）。 */
  function twoGroupsFixture() {
    setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "工作区一" }),
      makeWorkspace({ id: "ws-2", name: "工作区二" }),
    ]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-2", title: "会话B" }),
      ]),
    );
  }

  it("手动展开组 → 重挂载（模拟刷新）保持展开；未动过的组保持折叠", async () => {
    twoGroupsFixture();
    const first = renderPanel(<SessionListPanel />);
    await openGroup("工作区一");
    first.unmount();

    renderPanel(<SessionListPanel />);
    await screen.findByRole("button", { name: "工作区分组 工作区一" });
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区一" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区二" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "会话 会话A" }),
    ).toBeInTheDocument();
  });

  it("展开后再手动收起 → 记忆更新，重挂载保持收起", async () => {
    twoGroupsFixture();
    const first = renderPanel(<SessionListPanel />);
    await openGroup("工作区一");
    // 再点一次收起（用户显式折叠落盘）
    fireEvent.click(
      screen.getByRole("button", { name: "工作区分组 工作区一" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "工作区分组 工作区一" }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
    first.unmount();

    renderPanel(<SessionListPanel />);
    await screen.findByRole("button", { name: "工作区分组 工作区一" });
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区一" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "会话 会话A" }),
    ).not.toBeInTheDocument();
  });

  it("记忆与选中定位并集：记忆展开的组保持 + 选中会话所在组仍自动展开（不落盘）", async () => {
    twoGroupsFixture();
    // 先制造记忆：展开工作区二
    const first = renderPanel(<SessionListPanel />);
    await openGroup("工作区二");
    first.unmount();

    // 重挂载带选中 ws-1 会话：记忆(ws-2) ∪ 选中组(ws-1) 都展开
    renderPanel(<SessionListPanel selectedSessionId="s-1" />);
    expect(
      await screen.findByRole("button", { name: "会话 会话A" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "会话 会话B" }),
    ).toBeInTheDocument();
    // 兜底展开不落盘：记忆仍只有 ws-2
    expect(JSON.parse(window.localStorage.getItem(SESSION_TREE_EXPANSION_LS_KEY) ?? "{}")).toEqual({
      openGroups: ["ws-2"],
      openToolSections: [],
    });
  });

  it("「本地 Agent」小节展开记忆：展开后重挂载，组与小节都保持展开", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-normal",
          workspace_id: "ws-1",
          runtime_id: "rt-m1",
          title: "正常会话",
        }),
        makeSession({
          id: "s-tool",
          workspace_id: "ws-1",
          origin: "tool_report",
          title: "CLI 上报的会话",
        }),
      ]),
    );
    const first = renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    const toolHead = screen.getByRole("button", { name: "本地 Agent 小节" });
    fireEvent.click(toolHead);
    await waitFor(() => expect(toolHead).toHaveAttribute("aria-expanded", "true"));
    first.unmount();

    renderPanel(<SessionListPanel />);
    // 组与小节记忆都生效，条目直接可见
    expect(
      await screen.findByRole("button", { name: "会话 CLI 上报的会话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 Agent 小节" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("坏数据容错：localStorage 存垃圾 JSON → 静默回默认全折叠", async () => {
    window.localStorage.setItem(SESSION_TREE_EXPANSION_LS_KEY, "{oops");
    twoGroupsFixture();
    renderPanel(<SessionListPanel />);

    await screen.findByRole("button", { name: "工作区分组 工作区一" });
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区一" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "工作区分组 工作区二" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

// ── 11. 列表条件轮询（ql-20260824-004：左栏信息及时更新） ───────────────────

describe("SessionListPanel 列表条件轮询（ql-20260824-004）", () => {
  it("sessionListPollInterval：存在非终态会话→10s（聊天中近实时）；全终态/无数据→30s 巡航", () => {
    expect(sessionListPollInterval(undefined)).toBe(30_000);
    expect(sessionListPollInterval([])).toBe(30_000);
    expect(
      sessionListPollInterval([
        makeSession({ status: "ended" }),
        makeSession({ status: "failed" }),
      ]),
    ).toBe(30_000);
    expect(sessionListPollInterval([makeSession({ status: "active" })])).toBe(10_000);
    expect(sessionListPollInterval([makeSession({ status: "pending" })])).toBe(10_000);
    expect(sessionListPollInterval([makeSession({ status: "reconnecting" })])).toBe(10_000);
    // 混合：一条进行中即近实时
    expect(
      sessionListPollInterval([
        makeSession({ status: "ended" }),
        makeSession({ status: "active" }),
      ]),
    ).toBe(10_000);
  });

  it("轮询接线：活跃会话在场 10s 重拉；翻全终态后 10s 不拉、30s 拉（间隔随数据收敛）", async () => {
    vi.useFakeTimers();
    try {
      setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
      mocks.listAgentSessions.mockResolvedValue(
        listResponse([
          makeSession({ id: "s-1", workspace_id: "ws-1", status: "active", title: "会话A" }),
        ]),
      );
      renderPanel(<SessionListPanel />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterMount = mocks.listAgentSessions.mock.calls.length;

      // 活跃在场：10s 到点重拉
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mocks.listAgentSessions.mock.calls.length).toBeGreaterThan(afterMount);

      // 翻全终态：本次 10s 到点的重拉返回 ended → 间隔切 30s
      mocks.listAgentSessions.mockResolvedValue(
        listResponse([
          makeSession({ id: "s-1", workspace_id: "ws-1", status: "ended", title: "会话A" }),
        ]),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      const settled = mocks.listAgentSessions.mock.calls.length;
      // 30s 间隔：再过 10s 不拉，累计 30s 才拉
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mocks.listAgentSessions.mock.calls.length).toBe(settled);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(mocks.listAgentSessions.mock.calls.length).toBeGreaterThan(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 12. quicklog scope（task-10 / FR-04 / D-006@v1，X-008 消费分支补齐） ────

describe("SessionListPanel quicklog scope（task-10 / X-008）", () => {
  it("queryFn 透传 {limit:500, workspace_id, ql_id}；单组渲染 + 组头「＋」在；X-009 不渲染「关联」下拉", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-ql", workspace_id: "ws-1", title: "快速修复会话" }),
      ]),
    );
    renderPanel(
      <SessionListPanel
        scope={QUICKLOG_SCOPE}
        defaultExpandedWorkspaceId="ws-1"
        onNewInGroup={vi.fn()}
      />,
    );

    // X-008 消费点一（queryFn 透传）：workspace_id 走既有 in 判定 + ql_id 显式分支
    expect(
      await screen.findByRole("button", { name: "会话 快速修复会话" }),
    ).toBeInTheDocument();
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({
      limit: 500,
      archived: false,
      workspace_id: "ws-1",
      ql_id: "ql-20260825-001",
    });
    // X-008 消费点二（groups 单组模板）：组 id=workspaceId、canNew 真、名称解析命中
    expect(groupHeadLabels()).toEqual(["工作区分组 SillyHub"]);
    expect(
      screen.getByRole("button", { name: "在 SillyHub 新建会话" }),
    ).toBeInTheDocument();
    // X-009：quicklog scope 自身已按关联过滤，不叠加「关联」下拉与选项查询
    expect(document.getElementById("slp-assoc")).toBeNull();
    expect(mocks.listChanges).not.toHaveBeenCalled();
    expect(mocks.listQuicklogEntries).not.toHaveBeenCalled();
  });

  it("名称解析失败（工作区列表缺席）→ 兜底「当前工作区」单组，组头「＋」仍可新建", async () => {
    setWorkspaces([]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-ql", workspace_id: "ws-1", title: "快速修复会话" }),
      ]),
    );
    renderPanel(
      <SessionListPanel
        scope={QUICKLOG_SCOPE}
        defaultExpandedWorkspaceId="ws-1"
        onNewInGroup={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "工作区分组 当前工作区" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "在 当前工作区 新建会话" }),
    ).toBeInTheDocument();
  });
});

// ── 13. 「关联」筛选下拉（task-10 / FR-05 / X-009 门控 + 服务端过滤透传） ────

describe("SessionListPanel「关联」筛选下拉（task-10 / X-009）", () => {
  /** 选项数据固件：一条 title 变更 + 一条 title=null（change_key 回退）变更；
   * 快速修复一条非占位 + 一条占位（应被剔除）。 */
  function assocFixtures() {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listChanges.mockResolvedValue({
      items: [
        {
          id: "chg-a",
          change_key: "2026-08-25-session-spec-binding",
          title: "会话规范绑定",
          status: "execute",
          location: "active",
          change_type: null,
          is_thin: false,
          affected_components: [],
          owner_id: null,
          updated_at: "2026-08-25T10:00:00Z",
        },
        {
          id: "chg-b",
          change_key: "2026-08-23-frontend-dark-theme",
          title: null,
          status: "plan",
          location: "active",
          change_type: null,
          affected_components: [],
          owner_id: null,
          updated_at: "2026-08-23T10:00:00Z",
        },
      ],
      total: 2,
    });
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        {
          ql_id: "ql-20260824-014",
          title: "悬浮球去紫改青",
          status: "completed",
          placeholder: false,
        },
        {
          ql_id: "ql-20260824-999",
          title: "占位行",
          status: "stale",
          placeholder: true,
        },
      ],
      total: 2,
    });
  }

  it("X-009 门控：全局/change/quicklog/runtime scope 均不渲染下拉且选项查询零发起", async () => {
    // 全局（缺省 scope）
    const globalView = renderPanel(<SessionListPanel />);
    await screen.findByText("没有符合条件的会话");
    expect(document.getElementById("slp-assoc")).toBeNull();
    globalView.unmount();

    for (const sc of [CHANGE_SCOPE, QUICKLOG_SCOPE, RUNTIME_SCOPE]) {
      const view = renderPanel(<SessionListPanel scope={sc} />);
      await screen.findByText("没有符合条件的会话");
      expect(document.getElementById("slp-assoc")).toBeNull();
      view.unmount();
    }
    expect(mocks.listChanges).not.toHaveBeenCalled();
    expect(mocks.listQuicklogEntries).not.toHaveBeenCalled();
    // task-06（FR-05）：PPM 选项数据源同门控——非 workspace scope 零请求。
    expect(mocks.listPersonalPlanTasks).not.toHaveBeenCalled();
    expect(mocks.listProblems).not.toHaveBeenCalled();
  });

  it("workspace scope 渲染分组选项（变更 title 优先/change_key 回退、快速修复剔占位行）；选中变更 → change_id 透传；清除恢复", async () => {
    assocFixtures();
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    // 下拉渲染 + 选项查询参（变更组取活跃未归档 location=active）
    expect(document.getElementById("slp-assoc")).not.toBeNull();
    await waitFor(() => {
      expect(mocks.listChanges).toHaveBeenCalledWith("ws-1", {
        location: "active",
        pageSize: 100,
      });
      expect(mocks.listQuicklogEntries).toHaveBeenCalledWith("ws-1", {
        page_size: 100,
      });
    });

    // 打开下拉核对分组与选项（占位行被客户端过滤剔除）
    openAntdSelect("slp-assoc");
    await waitFor(() => {
      const groupTexts = [...document.querySelectorAll(".ant-select-item-group")].map(
        (el) => el.textContent,
      );
      expect(groupTexts).toEqual(["变更", "快速修复"]);
    });
    const optionTexts = [
      ...document.querySelectorAll(".ant-select-item-option-content"),
    ].map((el) => el.textContent);
    expect(optionTexts).toContain("会话规范绑定"); // title 优先
    expect(optionTexts).toContain("2026-08-23-frontend-dark-theme"); // title null → change_key
    expect(optionTexts).toContain("ql-20260824-014 悬浮球去紫改青"); // 短码 + 标题
    expect(optionTexts.some((t) => t?.includes("ql-20260824-999"))).toBe(false); // 占位剔除

    // 选中变更 → queryKey 槽位变化自动重拉，服务端过滤参 change_id 透传
    await chooseAntdOptionByText("slp-assoc", "会话规范绑定");
    await waitFor(() => {
      expect(lastCallArgs()).toEqual({
        limit: 500,
        archived: false,
        workspace_id: "ws-1",
        change_id: "chg-a",
      });
    });

    // allowClear 清除 → 恢复无关联过滤参（clear 图标在 #slp-assoc 所属
    // .ant-select 根下锚定，避免误点其它下拉）
    const assocRoot = closestAntdSelect(
      document.getElementById("slp-assoc") as HTMLElement,
    );
    if (!assocRoot) throw new Error(".ant-select for #slp-assoc not found");
    const clearBtn = queryAntdSelectClear(assocRoot);
    if (!clearBtn) throw new Error("assoc clear button not found");
    fireEvent.mouseDown(clearBtn);
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(lastCallArgs()).toEqual({ limit: 500, archived: false, workspace_id: "ws-1" });
    });
  });

  it("选中快速修复 → ql_id 透传（M:N 命中服务端过滤）", async () => {
    assocFixtures();
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);
    await waitFor(() => expect(mocks.listQuicklogEntries).toHaveBeenCalled());

    await chooseAntdOptionByText("slp-assoc", "ql-20260824-014 悬浮球去紫改青");
    await waitFor(() => {
      expect(lastCallArgs()).toEqual({
        limit: 500,
        archived: false,
        workspace_id: "ws-1",
        ql_id: "ql-20260824-014",
      });
    });
  });

  it("task-06（FR-05）：PPM 任务/问题分组选项 + 选中 ppm:<kind>:<uuid> → ppm_item_kind/ppm_item_id 透传", async () => {
    assocFixtures();
    // 当前登录用户（问题源 duty_user_id=me；任务走 personal 端点）。
    act(() => {
      useSession.setState({ user: { id: "u-1", email: "u@x.io", displayName: "U" } });
    });
    mocks.listPersonalPlanTasks.mockResolvedValue({
      items: [
        {
          id: "pt-1",
          content: "排行榜接口性能优化",
          task_description: null,
          project_name: "SillyHub 平台",
          status: "进行中",
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    mocks.listProblems.mockResolvedValue({
      items: [
        {
          id: "pb-1",
          pro_desc: "看板拖拽后排序偶发丢失",
          project_name: null,
          func_name: null,
          pro_type: "bug",
          status: "进行中",
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    // 选项查询参：口径同 @ 联想（任务 personal 端点 status=进行中；问题
    // duty_user_id=me + status=进行中）。
    await waitFor(() => {
      expect(mocks.listPersonalPlanTasks).toHaveBeenCalledWith({
        status: ["进行中"],
        page: 1,
        page_size: 100,
      });
      expect(mocks.listProblems).toHaveBeenCalledWith({
        duty_user_id: "u-1",
        status: ["进行中"],
        page: 1,
        page_size: 100,
      });
    });

    // 分组追加在变更/快速修复之后；label = 标题（+项目名括注）。
    openAntdSelect("slp-assoc");
    await waitFor(() => {
      const groupTexts = [...document.querySelectorAll(".ant-select-item-group")].map(
        (el) => el.textContent,
      );
      expect(groupTexts).toEqual([
        "变更",
        "快速修复",
        "PPM 任务（进行中）",
        "PPM 问题（进行中）",
      ]);
    });
    const optionTexts = [
      ...document.querySelectorAll(".ant-select-item-option-content"),
    ].map((el) => el.textContent);
    expect(optionTexts).toContain("排行榜接口性能优化（SillyHub 平台）");
    expect(optionTexts).toContain("看板拖拽后排序偶发丢失");

    // 选中 PPM 任务 → value 三段编码 ppm:plan_task:<uuid> 解析为成对过滤参透传。
    await chooseAntdOptionByText("slp-assoc", "排行榜接口性能优化（SillyHub 平台）");
    await waitFor(() => {
      expect(lastCallArgs()).toEqual({
        limit: 500,
        archived: false,
        workspace_id: "ws-1",
        ppm_item_kind: "plan_task",
        ppm_item_id: "pt-1",
      });
    });

    // 换选 PPM 问题 → kind=problem 成对透传（单值切换不叠加）。
    await chooseAntdOptionByText("slp-assoc", "看板拖拽后排序偶发丢失");
    await waitFor(() => {
      expect(lastCallArgs()).toEqual({
        limit: 500,
        archived: false,
        workspace_id: "ws-1",
        ppm_item_kind: "problem",
        ppm_item_id: "pb-1",
      });
    });

    // 清除恢复无关联过滤参。
    const assocRoot = closestAntdSelect(
      document.getElementById("slp-assoc") as HTMLElement,
    );
    if (!assocRoot) throw new Error(".ant-select for #slp-assoc not found");
    const clearBtn = queryAntdSelectClear(assocRoot);
    if (!clearBtn) throw new Error("assoc clear button not found");
    fireEvent.mouseDown(clearBtn);
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(lastCallArgs()).toEqual({ limit: 500, archived: false, workspace_id: "ws-1" });
    });
  });

  it("task-06：当前用户未就绪（user=null）→ 问题选项查询零发起（防全量清单），任务照常", async () => {
    assocFixtures();
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);
    await waitFor(() => expect(mocks.listPersonalPlanTasks).toHaveBeenCalled());
    expect(mocks.listProblems).not.toHaveBeenCalled();
  });
});

/* ───── 2026-08-26-subsession-portal-grouping（P3）：分身子会话折叠分组 ───── */



describe("SessionListPanel 分身子会话折叠分组（P3）", () => {
  /** 主控会话 + 两分身（parent 挂主控）。 */
  function subsessionFixtures() {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const main = makeSession({ id: "s-main", workspace_id: "ws-1", title: "团队主任务" });
    const sub1 = makeSession({
      id: "s-sub-1",
      title: "分身甲",
      workspace_id: "ws-1",
      runtime_id: "rt-m1",
      parent_session_id: "s-main",
      tree_depth: 1,
    });
    const sub2 = makeSession({
      id: "s-sub-2",
      title: "分身乙",
      workspace_id: "ws-1",
      runtime_id: "rt-m1",
      parent_session_id: "s-main",
      tree_depth: 1,
    });
    mocks.listAgentSessions.mockResolvedValue(listResponse([main, sub1, sub2]));
  }

  it("子会话默认折叠——主列表只见父行与「分身 2」折叠组头，子行不可见", async () => {
    subsessionFixtures();
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");

    expect(await screen.findByText("团队主任务")).toBeVisible();
    expect(screen.getByText("分身 2")).toBeVisible();
    expect(screen.queryByText("分身甲")).toBeNull();
    expect(screen.queryByText("分身乙")).toBeNull();
  });

  it("点击折叠组头展开——子行出现且可点击选中", async () => {
    subsessionFixtures();
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");
    await screen.findByText("团队主任务");

    fireEvent.click(screen.getByText("分身 2"));
    expect(await screen.findByText("分身甲")).toBeVisible();
    expect(screen.getByText("分身乙")).toBeVisible();
  });

  it("孤儿小节兜底——父不在列表时子会话进「团队分身」小节不丢行", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const orphan = makeSession({
      id: "s-orphan",
      title: "迷路的分身",
      workspace_id: "ws-1",
      runtime_id: "rt-m1",
      parent_session_id: "s-not-here",
      tree_depth: 1,
    });
    const normal = makeSession({ id: "s-normal", workspace_id: "ws-1", runtime_id: "rt-m1", title: "普通会话" });
    mocks.listAgentSessions.mockResolvedValue(listResponse([normal, orphan]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");

    expect(await screen.findByText("普通会话")).toBeVisible();
    expect(screen.getByText("团队分身")).toBeVisible();
    // 默认收起：孤儿子行不可见，展开后可见。
    expect(screen.queryByText("迷路的分身")).toBeNull();
    fireEvent.click(screen.getByText("团队分身"));
    expect(await screen.findByText("迷路的分身")).toBeVisible();
  });


  it("审计 F5+F7：全量计数不受组内截断影响——父行附属组徽标按全量子会话计数", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    // 1 主控 + 3 分身（全量）——不触发 50 截断，但断言计数来自全量集合语义
    const main = makeSession({ id: "s-main", workspace_id: "ws-1", title: "团队主任务" });
    const subs = [1, 2, 3].map((i) =>
      makeSession({
        id: `s-sub-${i}`,
        title: `分身${i}`,
        workspace_id: "ws-1",
        runtime_id: "rt-m1",
        parent_session_id: "s-main",
        tree_depth: 1,
      }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse([main, ...subs]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");

    expect(await screen.findByText("分身 3")).toBeVisible();
    fireEvent.click(screen.getByText("分身 3"));
    expect(await screen.findByText("分身1")).toBeVisible();
  });

  it("审计 F5：筛选变化重置分身折叠展开态——改状态筛选后附属组回到收起", async () => {
    subsessionFixtures();
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");
    await screen.findByText("团队主任务");

    fireEvent.click(screen.getByText("分身 2"));
    expect(await screen.findByText("分身甲")).toBeVisible();

    // 切状态筛选（filterEpoch 变化）→ openParents 重置 → 折叠回收起。
    // fixtures 默认 status=active，选「在线」（FR-02 更名+三态口径，active
    // 命中）保持数据可见（纯验证重置副作用）。
    await chooseAntdOptionByText("slp-status", "在线");
    await waitFor(() => {
      expect(screen.queryByText("分身甲")).toBeNull();
    });
  });

  it("无子会话列表零变化——不渲染折叠组头", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-a", workspace_id: "ws-1", runtime_id: "rt-m1", title: "普通甲" })]),
    );
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");
    await screen.findByText("普通甲");
    expect(screen.queryByText(/分身 \d/)).toBeNull();
    expect(screen.queryByText("团队分身")).toBeNull();
  });
});

// ── 11. 群聊分区（task-07 / 2026-09-01-session-group-chat / FR-01） ────────

/** 群列表项固件（GroupChatListItemRead：members 摘要 + last_message）。 */
function makeGroupListItem(
  overrides: Partial<
    import("@/lib/daemon").GroupChatListItemRead
  > = {},
): import("@/lib/daemon").GroupChatListItemRead {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 2,
    context_window: 20,
    consensus_mode: false,
    consensus_timeout_seconds: 600,
    cross_mention_mode: "private",
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
    last_message: "小码：已定位到问题在 hooks 依赖数组…",
    unread_count: 0,
    // D-003（2026-09-13-session-group-ux-fixes）：可见工作区集合默认 = 直接
    // 归属（无项目群的后端口径）；换 workspace 的 override 须同步换此字段。
    visible_workspace_ids: ["ws-1"],
    ...overrides,
  };
}

describe("SessionListPanel 群聊分区（task-07）", () => {
  it("群行渲染：facepile 成员摘要（agent=brand/用户=info）+ 群名 + 群聊徽标 + 最后消息摘要；点击回调 + 选中高亮", async () => {
    const onSelectGroup = vi.fn();
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(
      <SessionListPanel onSelectGroup={onSelectGroup} selectedGroupId="g-1" />,
    );
    await waitFor(() => expect(mocks.listGroupChats).toHaveBeenCalledTimes(1));
    // 独立数据源：群分区不掺单聊 agentSessions。
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);

    const row = await screen.findByRole("button", {
      name: "群聊 前端攻坚小分队",
    });
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("群聊分区")).toBeTruthy();
    expect(screen.getByText("1 个")).toBeTruthy();
    expect(row.textContent).toContain("小码：已定位到问题在 hooks 依赖数组…");
    // facepile：成员昵称 title 提示（小码/林一）。
    expect(row.querySelector('[title="小码"]')).toBeTruthy();
    expect(row.querySelector('[title="林一"]')).toBeTruthy();
    // 群 P2 第二波：unread_count=0（固件缺省）→ 未读徽标不渲染。
    expect(screen.queryByTestId("group-unread-badge")).toBeNull();

    fireEvent.click(row);
    expect(onSelectGroup).toHaveBeenCalledTimes(1);
    expect(onSelectGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "g-1",
        title: "前端攻坚小分队",
      }),
    );
  });

  it("未传 onSelectGroup（悬浮助手 runtime 抽屉等消费点）→ 分区零渲染零请求", async () => {
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    expect(screen.queryByLabelText("群聊分区")).toBeNull();
    expect(screen.queryByTestId("group-chat-row")).toBeNull();
    expect(mocks.listGroupChats).not.toHaveBeenCalled();
  });

  it("workspace scope：群按 visible_workspace_ids 集合过滤（无项目关联的他工作区群不渲染）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem(),
      makeGroupListItem({
        id: "g-2",
        title: "别家的群",
        workspace_id: "ws-other",
        // D-003：无项目关联群，集合 = 仅直接归属。
        visible_workspace_ids: ["ws-other"],
      }),
    ]);
    renderPanel(
      <SessionListPanel
        scope={{ kind: "workspace", workspaceId: "ws-1" }}
        onSelectGroup={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.listGroupChats).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "群聊 前端攻坚小分队" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "群聊 别家的群" }),
    ).toBeNull();
  });

  // D-003（2026-09-13-session-group-ux-fixes）：群可见性 = 直接归属 ∪ 项目
  // 关联工作区（后端组装进 visible_workspace_ids，前端集合判定）。
  it("D-003 workspace scope：挂 D 项目关联 D/F 的群在 D/F 两 scope 均渲染；旧缓存无字段退化直接归属", async () => {
    setWorkspaces([
      makeWorkspace({ id: "ws-d", name: "工作区D" }),
      makeWorkspace({ id: "ws-f", name: "工作区F" }),
    ]);
    mocks.listGroupChats.mockResolvedValue([
      // 群直接挂 D，项目关联 D/F → 集合两工作区（后端去重口径）。
      makeGroupListItem({
        id: "g-proj",
        title: "项目群",
        workspace_id: "ws-d",
        project_id: "ppm-1",
        visible_workspace_ids: ["ws-d", "ws-f"],
      }),
      // 旧缓存形态：字段缺失（显式 undefined 模拟 react-query 缓存未含新
      // 字段）→ `?? [workspace_id]` 兜底，仅直接归属 F 可见（不闪隐）。
      makeGroupListItem({
        id: "g-legacy",
        title: "旧缓存群",
        workspace_id: "ws-f",
        visible_workspace_ids: undefined,
      }),
    ]);
    // scope D：项目群经集合可见；旧缓存群（直接归属 F）不可见。
    const { unmount } = renderPanel(
      <SessionListPanel
        scope={{ kind: "workspace", workspaceId: "ws-d" }}
        onSelectGroup={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.listGroupChats).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "群聊 项目群" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "群聊 旧缓存群" }),
    ).toBeNull();
    unmount();

    // scope F：项目群经集合可见（跨工作区显示——本变更核心行为）；旧缓存群
    // 经兜底直接归属可见。
    renderPanel(
      <SessionListPanel
        scope={{ kind: "workspace", workspaceId: "ws-f" }}
        onSelectGroup={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.listGroupChats).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "群聊 项目群" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "群聊 旧缓存群" }),
    ).toBeTruthy();
  });

  it("runtime scope：分区隐藏（群无 runtime 归属，语义偏离不挂）", async () => {
    renderPanel(
      <SessionListPanel
        scope={{ kind: "runtime", runtimeId: "rt-1" }}
        onSelectGroup={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    expect(screen.queryByLabelText("群聊分区")).toBeNull();
    expect(mocks.listGroupChats).not.toHaveBeenCalled();
  });

  it("分区头「＋」→ onNewGroup 回调（门户开三步建群向导）", async () => {
    const onNewGroup = vi.fn();
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(
      <SessionListPanel onSelectGroup={vi.fn()} onNewGroup={onNewGroup} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "新建群聊" }),
    );
    expect(onNewGroup).toHaveBeenCalledTimes(1);
  });

  it("群列表查询失败 → 错误条 + 重新加载恢复", async () => {
    mocks.listGroupChats
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([makeGroupListItem()]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);
    expect(await screen.findByText(/加载群聊失败：boom/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(
      await screen.findByRole("button", { name: "群聊 前端攻坚小分队" }),
    ).toBeTruthy();
  });
});

// ── 11b. 群行「@我」未读提示（群聊体验 quick，2026-09-02）─────────────────

describe("SessionListPanel 群行 @我未读提示（quick）", () => {
  beforeEach(() => {
    // 已读记忆隔离（group-unread key；跨用例残留会让未读用例误判已读）。
    window.localStorage.removeItem("sillyhub-group-last-open-g-1");
  });

  it("last_mention 晚于已读记忆 → 行首红点 + [有人@我] 前缀；mention 摘要进 title", async () => {
    // 从未打开过群（无已读记忆）→ 恒未读。
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({
        last_mention: {
          content: "@鲸落 看下这个白屏",
          ts: "2026-09-02T03:00:00Z",
          member_name: "小码",
        },
      }),
    ]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);

    const row = await screen.findByTestId("group-chat-row");
    expect(row.getAttribute("data-mention-unread")).toBe("true");
    expect(
      screen.getByTestId("group-mention-unread-dot"),
    ).toBeTruthy();
    expect(screen.getByTestId("group-mention-unread-badge").textContent).toBe(
      "[有人@我]",
    );
    // aria-label 带未读语义（读屏可感知）。
    expect(
      screen.getByRole("button", { name: "群聊 前端攻坚小分队（有人@我）" }),
    ).toBeTruthy();
    // 摘要行 title 提及者 + 内容（微信式列表预览）。
    expect(row.querySelector('[title="小码：@鲸落 看下这个白屏"]')).toBeTruthy();
  });

  it("已读（本地打开时间新于 mention）→ 无红点无前缀，摘要行原样", async () => {
    window.localStorage.setItem(
      "sillyhub-group-last-open-g-1",
      "2026-09-02T04:00:00.000Z",
    );
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({
        last_mention: {
          content: "@鲸落 看下这个白屏",
          ts: "2026-09-02T03:00:00Z",
          member_name: "小码",
        },
      }),
    ]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);

    const row = await screen.findByTestId("group-chat-row");
    expect(row.getAttribute("data-mention-unread")).toBeNull();
    expect(screen.queryByTestId("group-mention-unread-dot")).toBeNull();
    expect(screen.queryByTestId("group-mention-unread-badge")).toBeNull();
    // aria-label 回到基础形态。
    expect(
      screen.getByRole("button", { name: "群聊 前端攻坚小分队" }),
    ).toBeTruthy();
  });

  it("无 last_mention（后端 null）→ 零未读渲染（不误报）", async () => {
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({ last_mention: null }),
    ]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);
    const row = await screen.findByTestId("group-chat-row");
    expect(row.getAttribute("data-mention-unread")).toBeNull();
    expect(screen.queryByTestId("group-mention-unread-dot")).toBeNull();
  });
});

// ── 11c. 群行未读数徽标（群 P2 第二波，2026-09-02）─────────────────────────

describe("SessionListPanel 群行未读数徽标（群 P2 第二波）", () => {
  it("unread_count>0 → 群名右侧数字徽标；99 封顶显示 99+；0 不渲染", async () => {
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({ id: "g-unread-5", unread_count: 5 }),
      makeGroupListItem({ id: "g-unread-99", title: "压测大群", unread_count: 99 }),
      makeGroupListItem({ id: "g-read-0", title: "已读静默群", unread_count: 0 }),
    ]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);

    await screen.findAllByTestId("group-chat-row");
    const badgeOf = (gid: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(
        `[data-group-id='${gid}'] [data-testid='group-unread-badge']`,
      );
    // 5 → 数字徽标。
    expect(badgeOf("g-unread-5")?.textContent).toBe("5");
    // 99（后端 cap）→ 99+。
    expect(badgeOf("g-unread-99")?.textContent).toBe("99+");
    // 0 → 不渲染。
    expect(badgeOf("g-read-0")).toBeNull();
  });

  it("与 @我红点并存：unread 徽标计数 + @我 红点/[有人@我] 前缀同屏（红点视觉优先）", async () => {
    window.localStorage.removeItem("sillyhub-group-last-open-g-1");
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({
        unread_count: 3,
        last_mention: {
          content: "@鲸落 看下这个白屏",
          ts: "2026-09-02T03:00:00Z",
          member_name: "小码",
        },
      }),
    ]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);

    const row = await screen.findByTestId("group-chat-row");
    expect(screen.getByTestId("group-unread-badge").textContent).toBe("3");
    expect(screen.getByTestId("group-mention-unread-dot")).toBeTruthy();
    expect(screen.getByTestId("group-mention-unread-badge").textContent).toBe(
      "[有人@我]",
    );
    expect(row.getAttribute("data-mention-unread")).toBe("true");
  });
});

// ── 12. 群聊分区折叠（quick：折叠交互 + localStorage 记忆） ────────────────

describe("SessionListPanel 群聊分区折叠（quick）", () => {
  it("默认展开：点分区头折叠 → 群行隐藏只留一行摘要（群聊 + 计数）→ localStorage 记忆", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);

    // 等群行渲染出来（仅作锚点等待，后续断言经 query 重查不取引用）。
    await screen.findByRole("button", {
      name: "群聊 前端攻坚小分队",
    });
    const header = screen.getByLabelText("群聊分区头");
    expect(header).toHaveAttribute("aria-expanded", "true");

    // 点分区头 → 折叠：群行隐藏、仅剩一行摘要（计数仍在头行）。
    fireEvent.click(header);
    await waitFor(() =>
      expect(screen.getByLabelText("群聊分区头")).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "群聊 前端攻坚小分队" }),
    ).toBeNull();
    expect(screen.getByText("1 个")).toBeTruthy();
    expect(
      window.localStorage.getItem(GROUP_SECTION_COLLAPSED_LS_KEY),
    ).toBe("1");

    // 再点 → 展开恢复（记忆同步翻回）。
    fireEvent.click(screen.getByLabelText("群聊分区头"));
    await waitFor(() =>
      expect(screen.getByLabelText("群聊分区头")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "群聊 前端攻坚小分队" }),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(GROUP_SECTION_COLLAPSED_LS_KEY),
    ).toBe("0");
  });

  it("重进页面读记忆：localStorage=1 → 初始即折叠（刷新恢复用户折叠态）", async () => {
    window.localStorage.setItem(GROUP_SECTION_COLLAPSED_LS_KEY, "1");
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);

    // 记忆命中：初始即折叠（群行零渲染），计数摘要仍在（等群列表就位）。
    await waitFor(() =>
      expect(screen.getByLabelText("群聊分区头")).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
    expect(await screen.findByText("1 个")).toBeTruthy();
    expect(
      screen.queryByTestId("group-chat-row"),
    ).toBeNull();
  });

  it("折叠态分区头「＋」不触发折叠（stopPropagation）→ onNewGroup 正常回调", async () => {
    const onNewGroup = vi.fn();
    window.localStorage.setItem(GROUP_SECTION_COLLAPSED_LS_KEY, "1");
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(
      <SessionListPanel onSelectGroup={vi.fn()} onNewGroup={onNewGroup} />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("群聊分区头")).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "新建群聊" }));
    expect(onNewGroup).toHaveBeenCalledTimes(1);
    // 点「＋」不改变折叠态。
    expect(screen.getByLabelText("群聊分区头")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

// ── 13. 群行收纳操作（task-06 / 2026-09-03-group-chat-archive-delete / FR-02/FR-03） ──
//
// 群行 hover 三按钮（归档/取消归档按 archived_at 二选一 + 删除）+ 已归档徽标
// 与整行降调 + 归档视图数据源（archived=true 重拉 +「＋」隐藏）+ Modal.confirm
// 三处理。断言口径：aria-label/文案/mock 调用参数（蓝图 acceptance），不碰
// 内部实现；portal 级 invalidate/清选中态接线由 sessions-portal 既有 39 用例
// 框架覆盖，此处面板级断言回调以正确参数被调用即可。
// Modal.confirm 交互照本文件会话删除先例（危险按钮类锚定 ok）+ runtimes 页
// 取消先例（within(confirmRoot) 点 /取\s*消/——antd 对两字中文自动插空格）。
describe("SessionListPanel 群行归档与删除操作（task-06）", () => {
  /** 当前 Modal.confirm 弹层（portal 到 body；残留多枚时取末位——最新追加）。 */
  function findConfirmRoot() {
    return waitFor(() => {
      const roots = document.querySelectorAll(".ant-modal-confirm");
      const el = roots[roots.length - 1] as HTMLElement | undefined;
      if (!el) throw new Error("confirm not open");
      return el;
    });
  }

  /** 弹层确认按钮（okText 两字中文可访问名被插空格，经主按钮类锚定）。 */
  function findConfirmOk() {
    return waitFor(() => {
      const btns = document.querySelectorAll(
        ".ant-modal-confirm-btns .ant-btn-primary",
      );
      const btn = btns[btns.length - 1] as HTMLElement | undefined;
      if (!btn) throw new Error("confirm ok button not found");
      return btn;
    });
  }

  it("默认视图未归档群行：hover 区「归档群聊 …」「删除群聊 …」在、「取消归档群聊 …」缺席；无已归档徽标无降调", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]); // archived_at 缺省 null
    renderPanel(
      <SessionListPanel
        onSelectGroup={vi.fn()}
        onArchiveGroup={vi.fn().mockResolvedValue(0)}
        onUnarchiveGroup={vi.fn().mockResolvedValue(0)}
        onDeleteGroup={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const row = await screen.findByTestId("group-chat-row");
    expect(
      screen.getByRole("button", { name: "归档群聊 前端攻坚小分队" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除群聊 前端攻坚小分队" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消归档群聊 前端攻坚小分队" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("已归档")).not.toBeInTheDocument();
    expect(row.className).not.toContain("opacity-60");
  });

  it("已归档群行（archived_at 非空）：「取消归档群聊 …」+「已归档」徽标（相对时间 title）+ 整行 opacity-60 降调；「归档群聊 …」二选一缺席、删除恒在", async () => {
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({ archived_at: "2026-09-02T00:00:00Z" }),
    ]);
    renderPanel(
      <SessionListPanel
        onSelectGroup={vi.fn()}
        onArchiveGroup={vi.fn().mockResolvedValue(0)}
        onUnarchiveGroup={vi.fn().mockResolvedValue(0)}
        onDeleteGroup={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const row = await screen.findByTestId("group-chat-row");
    expect(
      screen.getByRole("button", { name: "取消归档群聊 前端攻坚小分队" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "归档群聊 前端攻坚小分队" }),
    ).not.toBeInTheDocument();
    // 删除不随归档态隐藏。
    expect(
      screen.getByRole("button", { name: "删除群聊 前端攻坚小分队" }),
    ).toBeInTheDocument();
    const badge = screen.getByText("已归档");
    expect(badge.closest("span")?.getAttribute("title")).toContain("已归档（");
    // 整行降调（hover 恢复全不透明——收纳 vs 在用的层级语义）。
    expect(row.className).toContain("opacity-60");
  });

  it("归档视图（状态筛选「已归档会话」哨兵）：listGroupChats 以 archived=true 重拉；分区头「＋」隐藏；空态「暂无已归档群聊」", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(
      <SessionListPanel onSelectGroup={vi.fn()} onNewGroup={vi.fn()} />,
    );
    await screen.findByTestId("group-chat-row");
    // 默认视图：显式 archived=false（与单聊 sessionsQuery 同口径，仅未归档群）
    expect(mocks.listGroupChats).toHaveBeenCalledWith({ archived: false });
    expect(screen.getByRole("button", { name: "新建群聊" })).toBeInTheDocument();

    // 切归档视图：queryKey 视图维度变化自动重拉（mock 换已归档空集）
    mocks.listGroupChats.mockResolvedValue([]);
    await chooseAntdOptionByText("slp-status", "已归档会话");
    await waitFor(() => {
      const calls = mocks.listGroupChats.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toEqual({ archived: true });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("group-chat-row")).toBeNull(),
    );
    // 归档视图禁建新：分区头「＋」隐藏（design §6.2）。
    expect(
      screen.queryByRole("button", { name: "新建群聊" }),
    ).not.toBeInTheDocument();
    // 空态文案不引导「点＋」（该视图无「＋」，与实现一致）。
    expect(screen.getByText("暂无已归档群聊")).toBeInTheDocument();
  });

  it("删除确认流：Modal 文案含群名与「所有成员」语义；确认 → onDeleteGroup(群 id)", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    const onDeleteGroup = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      <SessionListPanel onSelectGroup={vi.fn()} onDeleteGroup={onDeleteGroup} />,
    );
    await screen.findByTestId("group-chat-row");
    fireEvent.click(
      screen.getByRole("button", { name: "删除群聊 前端攻坚小分队" }),
    );

    // 二次确认弹层：标题 + 群名 + 「所有成员」不可再见语义。
    const confirmRoot = await findConfirmRoot();
    expect(
      queryAntdConfirmTitle(confirmRoot),
    ).toHaveTextContent("删除群聊");
    expect(confirmRoot.textContent).toContain("前端攻坚小分队");
    expect(confirmRoot.textContent).toContain("所有成员");

    fireEvent.click(await findConfirmOk());
    await waitFor(() => expect(onDeleteGroup).toHaveBeenCalledWith("g-1"));
    expect(onDeleteGroup).toHaveBeenCalledTimes(1);
  });

  it("删除确认点「取消」→ onDeleteGroup 零触发（误点保护）", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    const onDeleteGroup = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      <SessionListPanel onSelectGroup={vi.fn()} onDeleteGroup={onDeleteGroup} />,
    );
    await screen.findByTestId("group-chat-row");
    fireEvent.click(
      screen.getByRole("button", { name: "删除群聊 前端攻坚小分队" }),
    );

    const confirmRoot = await findConfirmRoot();
    fireEvent.click(
      within(confirmRoot).getByRole("button", { name: /取\s*消/ }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(onDeleteGroup).not.toHaveBeenCalled();
    // 弹层收尾（防 portal 残留串到后续用例的 confirm 锚定）。
    await waitFor(() =>
      expect(queryAntdConfirm()).toBeNull(),
    );
  });

  it("归档确认流：确认 → onArchiveGroup(群 id) + 成功 toast 指引去归档视图", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    const onArchiveGroup = vi.fn().mockResolvedValue(0);
    renderPanel(
      <SessionListPanel
        onSelectGroup={vi.fn()}
        onArchiveGroup={onArchiveGroup}
      />,
    );
    await screen.findByTestId("group-chat-row");
    fireEvent.click(
      screen.getByRole("button", { name: "归档群聊 前端攻坚小分队" }),
    );
    fireEvent.click(await findConfirmOk());
    await waitFor(() => expect(onArchiveGroup).toHaveBeenCalledWith("g-1"));
    // 回调契约（返回失败个数=0）→ 成功 toast 指引查看路径。
    await waitFor(() =>
      expect(notifyMocks.success).toHaveBeenCalledWith(
        "已归档群聊「前端攻坚小分队」，可在筛选「已归档会话」中查看",
      ),
    );
  });

  it("已归档群行「取消归档」确认流：Modal 文案恢复语义 → 确认后 onUnarchiveGroup(群 id)", async () => {
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem({ archived_at: "2026-09-02T00:00:00Z" }),
    ]);
    const onUnarchiveGroup = vi.fn().mockResolvedValue(0);
    renderPanel(
      <SessionListPanel
        onSelectGroup={vi.fn()}
        onUnarchiveGroup={onUnarchiveGroup}
      />,
    );
    await screen.findByTestId("group-chat-row");
    fireEvent.click(
      screen.getByRole("button", { name: "取消归档群聊 前端攻坚小分队" }),
    );
    const confirmRoot = await findConfirmRoot();
    expect(
      queryAntdConfirmTitle(confirmRoot),
    ).toHaveTextContent("取消归档");
    expect(confirmRoot.textContent).toContain("恢复到默认列表");
    fireEvent.click(await findConfirmOk());
    await waitFor(() =>
      expect(onUnarchiveGroup).toHaveBeenCalledWith("g-1"),
    );
  });

  it("多群 id 透传：对第二群删除 → Modal 文案只绑定该群名，onDeleteGroup 收到 g-2（非首群串号）", async () => {
    mocks.listGroupChats.mockResolvedValue([
      makeGroupListItem(),
      makeGroupListItem({ id: "g-2", session_id: "s-g-2", title: "测试周会群" }),
    ]);
    const onDeleteGroup = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      <SessionListPanel onSelectGroup={vi.fn()} onDeleteGroup={onDeleteGroup} />,
    );
    await screen.findAllByTestId("group-chat-row");
    fireEvent.click(
      screen.getByRole("button", { name: "删除群聊 测试周会群" }),
    );
    // Modal 是 portal 独立子树：文案只含被操作群名（绑定无串号）。
    const confirmRoot = await findConfirmRoot();
    expect(confirmRoot.textContent).toContain("测试周会群");
    expect(confirmRoot.textContent).not.toContain("前端攻坚小分队");
    fireEvent.click(await findConfirmOk());
    await waitFor(() => expect(onDeleteGroup).toHaveBeenCalledWith("g-2"));
  });

  it("三收纳回调 props 缺省 → 群行零操作按钮（可选 props 行为锚点，既有消费点零回归）", async () => {
    mocks.listGroupChats.mockResolvedValue([makeGroupListItem()]);
    renderPanel(<SessionListPanel onSelectGroup={vi.fn()} />);
    await screen.findByTestId("group-chat-row");
    expect(
      screen.queryByRole("button", { name: "归档群聊 前端攻坚小分队" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "取消归档群聊 前端攻坚小分队" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "删除群聊 前端攻坚小分队" }),
    ).toBeNull();
  });
});

// ── 14. 行首状态槽语义 + 执行完成通知（2026-10-15-session-status-dot-semantics；
//        2026-10-15-session-turn-completion-semantics 完成口径改轮次级） ──
//
// 语义矩阵（用户确认，参考 deepseek-harness StateDot 五态）：failed→红点 /
// ended→绿点 / 活性 working→动态转圈 / 活性 blocked→琥珀点 / reconnecting→
// 动态转圈 / 活性 idle+完成标记→绿点（一轮刚跑完待查看）/ 其余（已读空闲/
// active 空闲/pending/suspended/活性 unknown/无活性）→留白（槽占位零可见
// 标识）；终态权威优先于活性。行尾活性小灯退役，悬停卡平移至行首槽。执行
// 完成通知两来源共键：①非终态→ended（面板检测）②working/blocked→idle 轮次
// 完成（hook 检测）→ 绿色角标，点击进入（selected 边沿）后消失。

describe("SessionListPanel 行首状态槽语义（2026-10-15-session-status-dot-semantics）", () => {
  /**
   * 标准单会话固件（ws-1 组内一条 s-a；status / 活性 state 可覆写，
   * livenessState 缺省 = 无活性数据（日志列表返回空）。
   */
  function slotFixture(
    sessionOverrides: Partial<AgentSessionRead> = {},
    livenessState?: AgentLogListItem["state"],
  ) {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          ...sessionOverrides,
        }),
      ]),
    );
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: livenessState
        ? [makeLivenessEntry({ agent_session_id: "s-a", state: livenessState })]
        : [],
    });
  }

  /** 渲染并展开组，返回目标行。 */
  async function renderRow() {
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    return screen.findByRole("button", { name: "会话 核对变更" });
  }

  it("failed → 红点（异常失败）；活性 working 不覆盖（终态权威）", async () => {
    slotFixture({ status: "failed" }, "working");
    const row = await renderRow();
    expect(row.querySelector('[aria-label="异常失败"]')).toBeTruthy();
    expect(screen.queryByLabelText("正在执行")).toBeNull();
  });

  it("ended → 绿点（执行完成）；活性数据不改变终态展示", async () => {
    slotFixture({ status: "ended" }, "working");
    const row = await renderRow();
    expect(row.querySelector('[aria-label="执行完成"]')).toBeTruthy();
    expect(screen.queryByLabelText("正在执行")).toBeNull();
  });

  it("active + 活性 working → 动态转圈（正在执行）——本平台 active 只表示会话开着，进行中以活性为准", async () => {
    slotFixture({ status: "active" }, "working");
    const row = await renderRow();
    expect(screen.getByLabelText("正在执行")).toBeTruthy();
    expect(row.querySelector('[aria-label="执行完成"]')).toBeNull();
    expect(row.querySelector('[aria-label="异常失败"]')).toBeNull();
  });

  it("active + 活性 blocked → 琥珀点（在等你）", async () => {
    slotFixture({ status: "active" }, "blocked");
    const row = await renderRow();
    expect(row.querySelector('[aria-label="在等你"]')).toBeTruthy();
    expect(screen.queryByLabelText("正在执行")).toBeNull();
  });

  it("reconnecting → 动态转圈（恢复中）", async () => {
    slotFixture({ status: "reconnecting" });
    await renderRow();
    expect(screen.getByLabelText("恢复中")).toBeTruthy();
  });

  it("active 空闲（无活性数据）→ 留白：槽占位但零可见标识", async () => {
    slotFixture({ status: "active" });
    const row = await renderRow();
    const slot = row.querySelector('[data-testid="session-status-indicator"]');
    expect(slot).toBeTruthy();
    expect(slot?.textContent).toBe("");
    expect(screen.queryByLabelText("正在执行")).toBeNull();
    expect(screen.queryByLabelText("执行完成")).toBeNull();
    expect(screen.queryByLabelText("在等你")).toBeNull();
  });

  it("pending（排队未开跑）→ 留白", async () => {
    slotFixture({ status: "pending" });
    const row = await renderRow();
    expect(
      row.querySelector('[data-testid="session-status-indicator"]')?.textContent,
    ).toBe("");
  });

  it("suspended（后端词表超集，前端类型外运行时值）→ 留白", async () => {
    slotFixture({
      status: "suspended",
    } as unknown as Partial<AgentSessionRead>);
    const row = await renderRow();
    expect(
      row.querySelector('[data-testid="session-status-indicator"]')?.textContent,
    ).toBe("");
  });

  it("活性命中：整槽包 Popover，悬停出组合悬停卡（状态名/静默时长/证据摘要/推导时间四行）", async () => {
    slotFixture({ status: "active" }, "working");
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    const slot = await screen.findByTestId("session-status-indicator");
    // antd Popover trigger=hover（默认 mouseEnterDelay 0.1s → waitFor 收敛，
    // 同 scheduled-messages-bar 悬停先例；content portal 到 body 不被行裁剪）。
    fireEvent.mouseEnter(slot);
    await waitFor(() =>
      expect(screen.getByText("在干活（working）")).toBeInTheDocument(),
    );
    expect(screen.getByText(/^静默时长：/)).toBeInTheDocument();
    expect(screen.getByText(/证据摘要：tool_use 未配对 ×2/)).toBeInTheDocument();
    expect(screen.getByText(/^推导时间：/)).toBeInTheDocument();
  });

  it("active + 活性 idle + 完成标记（一轮刚跑完待查看）→ 绿点 + 完成角标", async () => {
    window.localStorage.setItem(
      "sillyhub:session-completed-unread:s-a",
      String(Date.now()),
    );
    slotFixture({ status: "active" }, "idle");
    const row = await renderRow();
    expect(row.querySelector('[aria-label="执行完成"]')).toBeTruthy();
    expect(screen.getByLabelText("此会话已执行完成")).toBeTruthy();
  });

  // ── 2026-10-16-session-run-status-realtime：run 状态第一优先信号 ──────────

  it("run=running → 转圈（正在执行）——平台派发会话不依赖日志活性链", async () => {
    slotFixture({ status: "active", current_run_status: "running" });
    await renderRow();
    expect(screen.getByLabelText("正在执行")).toBeTruthy();
  });

  it("run=pending → 转圈（排队执行中）", async () => {
    slotFixture({ status: "active", current_run_status: "pending" });
    await renderRow();
    expect(screen.getByLabelText("正在执行")).toBeTruthy();
  });

  it("run=pending_approval → 琥珀点（在等你）——run 权威压过活性 working", async () => {
    slotFixture(
      { status: "active", current_run_status: "pending_approval" },
      "working",
    );
    const row = await renderRow();
    expect(row.querySelector('[aria-label="在等你"]')).toBeTruthy();
    expect(screen.queryByLabelText("正在执行")).toBeNull();
  });

  it("run 活跃时留白规则不变：无 run 无活性（active 空闲）→ 留白", async () => {
    slotFixture({ status: "active", current_run_status: null });
    const row = await renderRow();
    expect(
      row.querySelector('[data-testid="session-status-indicator"]')?.textContent,
    ).toBe("");
  });

  it("活性 idle：留白但悬停卡仍可查（详情不丢）", async () => {
    slotFixture({ status: "active" }, "idle");
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    const slot = await screen.findByTestId("session-status-indicator");
    expect(slot.textContent).toBe("");
    fireEvent.mouseEnter(slot);
    await waitFor(() =>
      expect(screen.getByText("空闲（idle）")).toBeInTheDocument(),
    );
  });

  it("行首槽位置：第一行首槽位、18px flex-none；标题 flex-1 不被挤成列", async () => {
    slotFixture({ status: "active" }, "working");
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    const slot = await screen.findByTestId("session-status-indicator");
    const firstLine = slot.parentElement;
    expect(firstLine).not.toBeNull();
    expect(firstLine?.className).toContain("flex");
    expect(firstLine?.className).toContain("items-center");
    expect(slot).toHaveClass("flex-none");
    expect(slot).toHaveClass("h-[18px]");
    expect(slot).toHaveClass("w-[18px]");
    const slots = Array.from(firstLine?.children ?? []);
    expect(slots.indexOf(slot)).toBe(0);
    expect(slots[1]?.className).toContain("flex-1");
  });
});

describe("SessionListPanel 轮次完成绿角标（working/blocked→idle 转移，2026-10-15-session-turn-completion-semantics）", () => {
  /** 带 client 句柄的渲染（转移用例需 refetchQueries 模拟 30s 轮询到点）。 */
  function renderPanelWithClient(ui: React.ReactElement) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
        mutations: { retry: false },
      },
    });
    const view = render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
    return { ...view, client };
  }

  /** working 活性单会话固件（ws-1 组内 s-a）。 */
  function livenessFixture() {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-a", workspace_id: "ws-1", title: "核对变更" }),
      ]),
    );
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "s-a", state: "working" })],
    });
  }

  it("绿点+完成角标出现：prevState=working → current=idle 转移写完成标记", async () => {
    livenessFixture();
    const { client } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByTestId("session-status-indicator");
    // 首轮 working：state 键落盘（首见不触发完成标记，转圈显示）
    await waitFor(() =>
      expect(window.localStorage.getItem("sillyhub:liveness-state:s-a")).toBe(
        "working",
      ),
    );
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();

    // 下一轮 idle（refetch 模拟 30s 轮询到点）：转移检测写完成标记
    // → 绿点（执行完成）+ 绿角标出现
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "s-a", state: "idle" })],
    });
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["agent-liveness-overview", "all"],
      });
    });
    await screen.findByLabelText("此会话已执行完成");
    expect(screen.getByLabelText("执行完成")).toBeTruthy();
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).not.toBeNull();
  });

  it("点击进入（selected 置真）→ 角标与绿点一并消失、落盘清除（空闲回归留白）", async () => {
    livenessFixture();
    const { client, rerender } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByTestId("session-status-indicator");
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "s-a", state: "idle" })],
    });
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["agent-liveness-overview", "all"],
      });
    });
    await screen.findByLabelText("此会话已执行完成");

    // selectedSessionId 置真（门户三路入口最终都落到该 prop）→ 边沿清除完成通知
    rerender(
      <QueryClientProvider client={client}>
        <SessionListPanel selectedSessionId="s-a" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("此会话已执行完成")).toBeNull(),
    );
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
    // 会话仍 active + 已读空闲 → 绿点一并消失，回归留白
    const row = screen.getByRole("button", { name: "会话 核对变更" });
    expect(
      row.querySelector('[data-testid="session-status-indicator"]')?.textContent,
    ).toBe("");
  });

  it("首见不标：无 prevState（localStorage 无 state 键）直接 idle 留白", async () => {
    livenessFixture();
    // 首轮直接 idle（首见无 prevState）
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "s-a", state: "idle" })],
    });
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByTestId("session-status-indicator");
    // state 键首见落盘为 idle，完成标记不写
    await waitFor(() =>
      expect(window.localStorage.getItem("sillyhub:liveness-state:s-a")).toBe(
        "idle",
      ),
    );
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();
  });

  it("正选中该会话时完成（suppress 谓词）→ 不标记不亮角标", async () => {
    livenessFixture();
    const { client } = renderPanelWithClient(
      <SessionListPanel selectedSessionId="s-a" />,
    );
    // 选中会话所在组豁免默认折叠（ql-20260824-001）——无需点击展开。
    await screen.findByTestId("session-status-indicator");
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "s-a", state: "idle" })],
    });
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["agent-liveness-overview", "all"],
      });
    });
    await waitFor(() =>
      expect(window.localStorage.getItem("sillyhub:liveness-state:s-a")).toBe(
        "idle",
      ),
    );
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();
  });
});

describe("SessionListPanel 执行完成通知（2026-10-15 用户补充：非终态→ended 且不在该会话上）", () => {
  /** 带 client 句柄的渲染（转移用例需 refetchQueries 模拟列表轮询到点）。 */
  function renderPanelWithClient(ui: React.ReactElement) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
        mutations: { retry: false },
      },
    });
    const view = render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
    return { ...view, client };
  }

  /** 单会话固件（ws-1 组内 s-a，status 可覆写；无活性数据）。 */
  function completedFixture(status: AgentSessionRead["status"]) {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status,
        }),
      ]),
    );
    mocks.listWorkspaceAgentLogs.mockResolvedValue({ items: [] });
  }

  it("active → ended 转移（非选中）→ 绿色完成角标出现并落盘", async () => {
    completedFixture("active");
    const { client } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 核对变更" });
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();

    // 列表轮询到点：会话完成
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "ended",
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await screen.findByLabelText("此会话已执行完成");
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).not.toBeNull();
  });

  it("点击进入（selected 置真）→ 角标消失、落盘清除，绿点本体保留", async () => {
    completedFixture("active");
    const { client, rerender } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 核对变更" });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "ended",
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await screen.findByLabelText("此会话已执行完成");

    rerender(
      <QueryClientProvider client={client}>
        <SessionListPanel selectedSessionId="s-a" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("此会话已执行完成")).toBeNull(),
    );
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
    // 完成态绿点本体保留（通知消失，状态标识仍在）
    expect(screen.getByLabelText("执行完成")).toBeTruthy();
  });

  it("完成时正选中该会话（用户就在其上）→ 不标记不亮角标", async () => {
    completedFixture("active");
    const { client } = renderPanelWithClient(
      <SessionListPanel selectedSessionId="s-a" />,
    );
    // 选中会话所在组豁免默认折叠（ql-20260824-001）——无需点击展开，
    // openGroup 的点击反而会把它折叠。
    await screen.findByRole("button", { name: "会话 核对变更" });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "ended",
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("执行完成")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
  });

  it("首载即 ended（历史会话，无转移基线）→ 不误报", async () => {
    completedFixture("ended");
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 核对变更" });
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
  });

  // ── 2026-10-16-session-run-status-realtime：run 完成触发源 ────────────────

  it("run 活跃→null（run 终态收敛，会话仍 active）→ 完成角标出现（run 来源，不等日志推导）", async () => {
    completedFixture("active");
    // 首轮：run=running（转圈）。
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "active",
          current_run_status: "running",
        }),
      ]),
    );
    const { client } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByLabelText("正在执行");
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();

    // 下一轮列表刷新（SSE/轮询）：run 终态收敛 → current_run_status=null
    // → run 完成检测写完成标记（会话仍 active，无活性数据也触发）。
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "active",
          current_run_status: null,
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await screen.findByLabelText("此会话已执行完成");
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).not.toBeNull();
  });

  it("run 跨刷新仍活跃（running→running，列表数据有变化）→ 不误标完成角标（活跃期误报回归）", async () => {
    completedFixture("active");
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "active",
          current_run_status: "running",
        }),
      ]),
    );
    const { client } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByLabelText("正在执行");
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();

    // 下一轮列表刷新：run 仍 running，但行数据有变化（标题字段变）——
    // 旧实现只看 before 真值即误写完成标记；修复后必须 current 归 null 才标记。
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更（改）",
          status: "active",
          current_run_status: "running",
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await screen.findByLabelText("正在执行");
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
  });

  it("run 活跃→null 但正选中该会话 → 不标记（run 来源同 suppress 口径）", async () => {
    completedFixture("active");
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "active",
          current_run_status: "running",
        }),
      ]),
    );
    const { client } = renderPanelWithClient(
      <SessionListPanel selectedSessionId="s-a" />,
    );
    // 选中会话所在组豁免默认折叠——无需点击展开。
    await screen.findByLabelText("正在执行");
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "active",
          current_run_status: null,
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("session-status-indicator")?.textContent ?? "",
      ).toBe(""),
    );
    expect(
      window.localStorage.getItem("sillyhub:session-completed-unread:s-a"),
    ).toBeNull();
  });

  it("active → failed 不出完成角标（异常走红点语义）", async () => {
    completedFixture("active");
    const { client } = renderPanelWithClient(<SessionListPanel />);
    await openGroup("SillyHub");
    await screen.findByRole("button", { name: "会话 核对变更" });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-a",
          workspace_id: "ws-1",
          title: "核对变更",
          status: "failed",
        }),
      ]),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ["agentSessions"] });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("异常失败")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("此会话已执行完成")).toBeNull();
  });
});
// ── 15. 导出入口（2026-09-14-session-export task-07 / FR-01 / FR-06） ──────
// task-06 双入口 UI 契约回归锁：批量栏「导出选中（N）」Dropdown + 行 hover
// 下载图标（aria-label「导出 {title}」）两入口共享两档菜单（items 单一源
// SESSION_EXPORT_MENU_ITEMS：导出对话（Markdown）/ 导出完整信息（JSON+附件））；
// onExportSessions 可选 prop——未传则两入口零渲染（照 onDeleteSessions 可选
// 模式先例）。回调 mock 不真发请求（lib 层 exportSessions 由 sessions-portal
// dynamic import 隔离，本测只锁面板契约：ids 数组 + tier 精确断言；成功 toast
// 口径按 handleExportSessions 实现，经 notifyMocks spy 断言）。
// 依据：session-list-panel.tsx task-06 段——批量栏 Dropdown（「导出选中（N）」
// 按钮）/ 行级「导出 {title}」图标按钮（!batchMode 才渲染）/ 两处
// SESSION_EXPORT_MENU_ITEMS + onExportSessions(ids, tier) 回调。
// antd Dropdown 弹层 portal 挂 body：经 screen 全局 menuitem 查询（不加 testid）。
// 多选入口沿用「批量与单条删除」块流程（多选按钮渲染门控 batchEnabled=
// Boolean(onDeleteSessions)——批量导出用例需同时传 onDeleteSessions）。
describe("SessionListPanel 导出入口（2026-09-14-session-export task-07）", () => {
  beforeEach(() => {
    // notifyMocks 为文件级共享 spy：本 describe 局部清零，锁 toast 断言口径。
    notifyMocks.success.mockClear();
    notifyMocks.warning.mockClear();
    notifyMocks.error.mockClear();
  });

  /** 标准导出固件（ws-1 组内 s-1 会话A / s-2 会话B）。 */
  function exportFixture() {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: "ws-1", title: "会话B" }),
      ]),
    );
  }

  it("批量 chat 档：多选勾 2 条 → 「导出选中（2）」→「导出对话（Markdown）」→ onExportSessions 带 ids=[s-1,s-2] tier=chat", async () => {
    exportFixture();
    const onExportSessions = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      <SessionListPanel
        onDeleteSessions={vi.fn().mockResolvedValue(0)}
        onExportSessions={onExportSessions}
      />,
    );
    await openGroup("SillyHub");

    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "多选 SillyHub" }));
    // 多选态：点行 = 勾选（照既有批量删除用例流程，勾 2 条）
    fireEvent.click(screen.getByRole("button", { name: "会话 会话A" }));
    fireEvent.click(screen.getByRole("button", { name: "会话 会话B" }));
    const exportBtn = await screen.findByRole("button", {
      name: /导出选中（2）/,
    });

    // antd Dropdown trigger=click：弹层 portal 挂 body，经 screen 查 menuitem
    fireEvent.click(exportBtn);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出对话（Markdown）" }),
    );
    await waitFor(() =>
      expect(onExportSessions).toHaveBeenCalledWith(["s-1", "s-2"], "chat"),
    );
  });

  it("批量 full 档：同菜单点「导出完整信息（JSON+附件）」→ tier=full（两档全锁）+ 成功 toast full 文案", async () => {
    exportFixture();
    const onExportSessions = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      <SessionListPanel
        onDeleteSessions={vi.fn().mockResolvedValue(0)}
        onExportSessions={onExportSessions}
      />,
    );
    await openGroup("SillyHub");

    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "多选 SillyHub" }));
    fireEvent.click(screen.getByRole("button", { name: "会话 会话A" }));
    fireEvent.click(screen.getByRole("button", { name: "会话 会话B" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /导出选中（2）/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出完整信息（JSON+附件）" }),
    );
    await waitFor(() =>
      expect(onExportSessions).toHaveBeenCalledWith(["s-1", "s-2"], "full"),
    );
    // 面板成功路径 toast（handleExportSessions，full 文案分支）
    await waitFor(() =>
      expect(notifyMocks.success).toHaveBeenCalledWith(
        "已开始下载完整信息导出（2 个会话）",
      ),
    );
  });

  it("行级入口：未进批量态点行 hover 下载图标（aria-label「导出 会话A」）→ chat 档 → 单会话 id + 成功 toast", async () => {
    exportFixture();
    const onExportSessions = vi.fn().mockResolvedValue(undefined);
    renderPanel(<SessionListPanel onExportSessions={onExportSessions} />);
    await openGroup("SillyHub");

    // hover 按钮经 CSS 显隐（jsdom 不裁剪 DOM，照「hover 删除按钮」用例直查）
    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "导出 会话A" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出对话（Markdown）" }),
    );
    await waitFor(() =>
      expect(onExportSessions).toHaveBeenCalledWith(["s-1"], "chat"),
    );
    // 面板成功路径 toast（handleExportSessions，chat 文案分支）
    await waitFor(() =>
      expect(notifyMocks.success).toHaveBeenCalledWith(
        "已开始下载对话导出（1 个会话）",
      ),
    );
  });

  it("未传 onExportSessions：批量栏无「导出选中」、行无「导出 {title}」图标（可选模式零渲染）", async () => {
    exportFixture();
    // onDeleteSessions 仍传（多选按钮 batchEnabled 门控依赖它——验证导出口
    // 缺省时批量栏其余操作照常、仅导出入口零渲染）
    renderPanel(
      <SessionListPanel onDeleteSessions={vi.fn().mockResolvedValue(0)} />,
    );
    await openGroup("SillyHub");

    // 行级：两行均无导出图标
    await screen.findByRole("button", { name: "会话 会话A" });
    expect(
      screen.queryByRole("button", { name: "导出 会话A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "导出 会话B" }),
    ).not.toBeInTheDocument();

    // 批量栏：进多选态勾 1 条，「删除选中（1）」在而「导出选中」零渲染
    fireEvent.click(screen.getByRole("button", { name: "多选 SillyHub" }));
    fireEvent.click(screen.getByRole("button", { name: "会话 会话A" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /删除选中（1）/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /导出选中/ }),
    ).not.toBeInTheDocument();
  });
});
