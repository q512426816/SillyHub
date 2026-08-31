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
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

import {
  SessionListPanel,
  SESSION_TREE_EXPANSION_LS_KEY,
  sessionListPollInterval,
  type SessionListScope,
} from "@/components/sessions/session-list-panel";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";
import { useSession } from "@/stores/session";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  // v2 两 scope 端点保留 mock 仅为 D-003@v2 零调用断言（数据源走全局端点）。
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
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
}));

// 组件只消费 listAgentSessions + 树拉取上限常量（类型导入编译期擦除），
// 局部 mock 不加载真实 daemon.ts；两 scope 端点 mock 供零调用断言。
vi.mock("@/lib/daemon", () => ({
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  listWorkspaceAgentSessions: (...args: unknown[]) =>
    mocks.listWorkspaceAgentSessions(...args),
  listChangeSessions: (...args: unknown[]) => mocks.listChangeSessions(...args),
  AGENT_SESSIONS_TREE_FETCH_LIMIT: 500,
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
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
    : (anchor.closest(".ant-select") as HTMLElement | null);
  if (!root) throw new Error(`.ant-select for #${selectId} not found`);
  const clickZone =
    (root.querySelector(".ant-select-content") as HTMLElement | null) ??
    (root.querySelector(".ant-select-selector") as HTMLElement | null);
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
  const optionRow = option.closest(".ant-select-item-option") as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  await act(async () => {
    await Promise.resolve();
  });
}

/** 点引擎胶囊 tab（change 分支；chips 里也有引擎名，须在 .ant-segmented 内锚定）。 */
function clickEngineTab(label: string) {
  const seg = document.querySelector(".ant-segmented");
  if (!seg) throw new Error(".ant-segmented not found");
  const item = [...seg.querySelectorAll(".ant-segmented-item")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!item) throw new Error(`engine tab "${label}" not found`);
  fireEvent.click(item);
  // Segmented 的 radio input 在 item 内，双保险点 label。
  const labelEl = item.querySelector("label") ?? item;
  fireEvent.click(labelEl);
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
  mocks.listWorkspaces.mockReset();
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
  it("默认一次拉取 limit=500；按 workspace_id 分组（工作区列表序+非工作区固定末尾）；0 会话组仍显示计数 0", async () => {
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

    // 分组顺序：工作区列表序 + 非工作区固定末尾（D-105）
    expect(groupHeadLabels()).toEqual([
      "工作区分组 SillyHub",
      "工作区分组 空工作区",
      "工作区分组 非工作区",
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
    expect(row.querySelector('[aria-label="状态 active"]')).toBeTruthy();
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

// ── 3/4. 两层筛选 tab（D-107：纯视图过滤不进数据层） ──────────────────────

describe("SessionListPanel 两层筛选 tab", () => {
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

    // 默认：仅机器层（无智能体层）
    expect(document.querySelector('[aria-label="智能体筛选层"]')).toBeNull();

    // 选 machine-2 → 仅其条目 + 智能体层出现 + 小节标题隐藏（FR-02）
    fireEvent.click(screen.getByRole("button", { name: "机器tab machine-2" }));
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(
      screen.queryByRole("button", { name: "会话 机器二Claude" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "会话 机器一Claude" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[aria-label="智能体筛选层"]')).not.toBeNull();
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

    // 选 machine-1 → 两条；再选 ◎ Codex → 仅 Codex
    fireEvent.click(screen.getByRole("button", { name: "机器tab machine-1" }));
    await waitFor(() => expect(sessionRows().length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "智能体tab Codex" }));
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(
      screen.getByRole("button", { name: "会话 机器一Codex" }),
    ).toBeInTheDocument();

    // 智能体「全部」清空
    fireEvent.click(screen.getByRole("button", { name: "智能体tab 全部" }));
    await waitFor(() => expect(sessionRows().length).toBe(2));

    // 机器「全部」清空并隐藏第二层
    fireEvent.click(screen.getByRole("button", { name: "机器tab 全部" }));
    await waitFor(() => expect(sessionRows().length).toBe(3));
    expect(document.querySelector('[aria-label="智能体筛选层"]')).toBeNull();
    expect(machineSection("machine-1")).not.toBeNull(); // 小节标题恢复
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
    fireEvent.click(screen.getByRole("button", { name: "机器tab machine-1" }));
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
    fireEvent.click(screen.getByRole("button", { name: "机器tab machine-1" }));
    fireEvent.click(screen.getByRole("button", { name: "智能体tab Claude Code" }));
    fireEvent.click(groupHead());
    await waitFor(() => {
      const filtered = screen.getByRole("button", { name: "会话 会话A" });
      expect(filtered.textContent).not.toContain("Claude"); // 筛选后隐藏
    });

    fireEvent.click(screen.getByRole("button", { name: "机器tab 全部" }));
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
    fireEvent.click(screen.getByRole("button", { name: "机器tab machine-1" }));
    fireEvent.click(
      screen.getByRole("button", { name: "智能体tab Claude Code" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "在 SillyHub 新建会话" }));
    expect(onNewInGroup).toHaveBeenCalledWith("ws-1", {
      machineId: "m-1",
      agent: "claude",
    });
  });

  it("组内超 50 截断 + 「显示全部」（R-03）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const many = Array.from({ length: 60 }, (_, i) =>
      makeSession({ id: `s-${i}`, workspace_id: "ws-1", title: `批量会话${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(many));
    renderPanel(<SessionListPanel />);
    await openGroup("SillyHub");

    await waitFor(() => expect(sessionRows().length).toBe(50));
    const moreBtn = screen.getByRole("button", { name: /显示全部/ });
    expect(moreBtn.textContent).toContain("共 60 条");

    fireEvent.click(moreBtn);
    await waitFor(() => expect(sessionRows().length).toBe(60));
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
    // 平铺控件退役（引擎胶囊/机器多选/加载更多）
    expect(document.querySelector(".ant-segmented")).toBeNull();
    expect(document.getElementById("slp-machine")).toBeNull();
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

    // 机器 tab 切换 → R-05 重置：组与小节都回默认折叠
    fireEvent.click(screen.getByRole("button", { name: "机器tab machine-1" }));
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
    const assocRoot = (document.getElementById("slp-assoc") as HTMLElement)
      .closest(".ant-select");
    if (!assocRoot) throw new Error(".ant-select for #slp-assoc not found");
    const clearBtn = assocRoot.querySelector(".ant-select-clear");
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
    const assocRoot = (document.getElementById("slp-assoc") as HTMLElement)
      .closest(".ant-select");
    if (!assocRoot) throw new Error(".ant-select for #slp-assoc not found");
    const clearBtn = assocRoot.querySelector(".ant-select-clear");
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
    // fixtures 默认 status=active，选「活跃」保持数据可见（纯验证重置副作用）。
    await chooseAntdOptionByText("slp-status", "活跃");
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
