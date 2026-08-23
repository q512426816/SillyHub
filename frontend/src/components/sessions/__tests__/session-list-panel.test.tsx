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
  type SessionListScope,
} from "@/components/sessions/session-list-panel";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  // v2 两 scope 端点保留 mock 仅为 D-003@v2 零调用断言（数据源走全局端点）。
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
  machinesHook: vi.fn(),
  machinesRefetch: vi.fn(),
  listWorkspaces: vi.fn(),
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
  mocks.machinesHook.mockReturnValue({
    items: [],
    total: 0,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mocks.machinesRefetch,
    ...r,
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
  setWorkspaces();
  setMachines();
  mocks.machinesRefetch.mockReset();
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

    await screen.findByRole("button", { name: "会话 核对变更" });
    // 数据层：一次拉取 limit=500（D-103），无过滤参
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 500 });

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

    const row = await screen.findByRole("button", { name: "会话 整理会议纪要" });
    expect(row.textContent).toContain("Claude");
    expect(row.textContent).toContain("👤 qinyi");
    expect(row.textContent).toContain("📋 知识经理");
    expect(row.textContent).toContain("☁ Kimi");
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

    const row = await screen.findByRole("button", { name: "会话 旧会话" });
    expect(row.textContent).toContain("👤 —");
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

    const row = await screen.findByRole("button", { name: "会话 旧会话" });
    expect(row.textContent).toContain("Codex");
    expect(row.textContent).not.toContain("📋");
    expect(row.textContent).not.toContain("☁");
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
    expect(lastCallArgs()).toEqual({ limit: 500 });
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
    fireEvent.click(screen.getByRole("button", { name: "智能体tab ◎ Codex" }));
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
    // 缺省全展开：两组条目都可见
    await screen.findByRole("button", { name: "会话 会话A" });
    expect(screen.getByRole("button", { name: "会话 会话B" })).toBeInTheDocument();

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
    await waitFor(() => expect(sessionRows().length).toBe(2));

    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() => expect(sessionRows().length).toBe(1));
    expect(screen.getByRole("button", { name: "会话 结束会话" })).toBeInTheDocument();
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);

    // 切回全部状态
    await chooseAntdOptionByText("slp-status", "全部状态");
    await waitFor(() => expect(sessionRows().length).toBe(2));
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

// ── 6. 组头交互 + 截断（R-03） ────────────────────────────────────────────

describe("SessionListPanel 组头回调与截断", () => {
  it("组头「＋」→ onNewInGroup(workspaceId)；非工作区组「＋」→ onNewInGroup(null)（D-105）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", workspace_id: "ws-1", title: "会话A" }),
        makeSession({ id: "s-2", workspace_id: null, title: "临时问答" }),
      ]),
    );
    const onNewInGroup = vi.fn();
    renderPanel(<SessionListPanel onNewInGroup={onNewInGroup} />);

    await screen.findByRole("button", { name: "会话 会话A" });
    fireEvent.click(screen.getByRole("button", { name: "在 SillyHub 新建会话" }));
    expect(onNewInGroup).toHaveBeenCalledWith("ws-1");

    fireEvent.click(screen.getByRole("button", { name: "在 非工作区 新建会话" }));
    expect(onNewInGroup).toHaveBeenCalledWith(null);
    expect(onNewInGroup).toHaveBeenCalledTimes(2);
  });

  it("组内超 50 截断 + 「显示全部」（R-03）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const many = Array.from({ length: 60 }, (_, i) =>
      makeSession({ id: `s-${i}`, workspace_id: "ws-1", title: `批量会话${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(many));
    renderPanel(<SessionListPanel />);

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
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    await screen.findByRole("button", { name: "会话 工作区会话" });
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 500, workspace_id: "ws-1" });
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
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    const row = await screen.findByRole("button", { name: "会话 全字段会话" });
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeInTheDocument();
    // 全字段 chips（D-003@v2：全局端点返回全字段，树形态照常渲染）
    expect(row.textContent).toContain("Claude");
    expect(row.textContent).toContain("👤 qinyi");
    expect(row.textContent).toContain("📋 知识经理");
    expect(row.textContent).toContain("☁ Kimi");
    expect(row.textContent).toContain("7 轮");
    expect(row.textContent).toContain("5 分钟前");
    // 机器名经快照回退落小节标题（机器列表留空证明不依赖映射）
    expect(machineSection("DESKTOP-2BN7FDC")).not.toBeNull();
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });
});

describe("SessionListPanel change scope（维持现状平铺列表，design §3 边界）", () => {
  it("数据源：{limit:50, workspace_id, change_id} 双传；v2 两 scope 端点零调用；平铺控件（引擎 Segmented/机器多选）在", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-chg", workspace_id: "ws-1", title: "变更会话" })]),
    );
    renderPanel(<SessionListPanel scope={CHANGE_SCOPE} />);

    expect(
      await screen.findByRole("button", { name: "会话 变更会话" }),
    ).toBeInTheDocument();
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({
      limit: 50,
      workspace_id: "ws-1",
      change_id: "chg-1",
    });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();
    // 平铺现状控件在（不回归）：状态下拉 + 机器多选 + 引擎胶囊
    expect(document.getElementById("slp-status")).not.toBeNull();
    expect(document.getElementById("slp-machine")).not.toBeNull();
    expect(document.querySelector(".ant-segmented")).not.toBeNull();
    // 无工作区树分组头
    expect(groupHeadLabels()).toEqual([]);
  });

  it("服务端筛选照常带参：状态 status / 引擎 provider / 机器 machine_id（scope 过滤参 + 筛选参同传）", async () => {
    setMachines({ items: twoMachines() });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel scope={CHANGE_SCOPE} />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({
      limit: 50,
      workspace_id: "ws-1",
      change_id: "chg-1",
      status: "ended",
    });

    clickEngineTab("Claude");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(3));
    expect(lastCallArgs()).toEqual({
      limit: 50,
      workspace_id: "ws-1",
      change_id: "chg-1",
      status: "ended",
      provider: "claude",
    });

    await chooseAntdOptionByText("slp-machine", "machine-2");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(4));
    expect(lastCallArgs()).toEqual({
      limit: 50,
      workspace_id: "ws-1",
      change_id: "chg-1",
      status: "ended",
      provider: "claude",
      machine_id: "m-2",
    });
  });

  it("搜索回车触发 q（服务端参数）；仅输入不触发", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel scope={CHANGE_SCOPE} />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("搜索会话标题");
    fireEvent.change(input, { target: { value: "会议" } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1); // 输入不触发

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({
      limit: 50,
      workspace_id: "ws-1",
      change_id: "chg-1",
      q: "会议",
    });
  });

  it("加载更多 offset 递增（后端真分页保留，R-04）", async () => {
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const page1 = Array.from({ length: 50 }, (_, i) =>
      makeSession({ id: `p1-${i}`, workspace_id: "ws-1", title: `第一页${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(page1, { total: 60 }));
    renderPanel(<SessionListPanel scope={CHANGE_SCOPE} />);

    const moreBtn = await screen.findByRole("button", { name: /加载更多/ });
    expect(moreBtn.textContent).toContain("50/60");
    const page2 = Array.from({ length: 10 }, (_, i) =>
      makeSession({ id: `p2-${i}`, workspace_id: "ws-1", title: `第二页${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(page2, { total: 60 }));
    fireEvent.click(moreBtn);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toMatchObject({ limit: 50, offset: 50 });
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
    renderPanel(<SessionListPanel scope={CHANGE_SCOPE} />);

    expect(
      await screen.findByRole("button", { name: "会话 我的会话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeInTheDocument();
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });
});
