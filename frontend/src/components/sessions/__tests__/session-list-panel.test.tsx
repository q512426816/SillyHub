/**
 * SessionListPanel 单测（2026-08-14-sessions-portal task-11 / FR-02 / D-003 / D-006 / R-04）。
 *
 * 依据：
 *   - components/sessions/session-list-panel.tsx（本 task 实现）
 *   - tasks/task-11.md acceptance：四维筛选组合走后端过滤参数、虚拟滚动只渲染
 *     可视区、chips 读 config_snapshot、点击条目回调 onSelect
 *
 * 覆盖：
 *   1. 初次渲染默认查询（limit，不带过滤参数）+ 条目两行渲染（标题/状态点/chips）
 *   2. 引擎 tab（provider 参数）单选即查
 *   3. 状态下拉（status 参数）
 *   4. 机器单选（machine_id server 侧过滤）；机器多选（后端单值参数装不下 →
 *      不带 machine_id + 客户端过滤）
 *   5. 搜索回车触发（q 参数）；仅输入不回车不触发
 *   6. chips 读 config_snapshot；快照缺省回退 runtime/provider 基础信息；
 *      离线机器 chip 划线 +（离线）
 *   7. 点击条目 onSelect 回调 + 选中态高亮（aria-pressed）
 *   8. 空态；错误态
 *   9. 虚拟滚动：大列表只渲染可视区（mount 即可，不测滚动物理行为）
 *   10. 加载更多（后端真分页 offset 递增，R-04）
 *   11. workspace scope（2026-08-22-workspace-sessions-portal task-04 /
 *      D-003@v1 直接断言）：数据源切 listWorkspaceAgentSessions(ws,
 *      include_ended=true) 且 listAgentSessions 零调用；仅本人过滤（他人
 *      剔除、author 缺失保留）
 *   12. scope 筛选条降级（Grill P1-2）：状态/机器/引擎三控件不渲染、本地
 *      标题搜索客户端过滤（不重查）、「加载更多」不出现（单页合成）
 *   13. scope 瘦字段降级（Grill P1-1 / design §4.B）：条目无 runtime_id /
 *      config_snapshot → 机器/档案/供应商 chips 不渲染，时间列相对时间或 —
 *
 * mock 策略：直接 mock 组件消费的模块（@/lib/daemon 的 listAgentSessions /
 * @/lib/use-daemon-machines），@/lib/api 保留真实（ApiError instanceof 用）。
 *
 * jsdom 已知坑：@tanstack/react-virtual 的 observeElementRect 同步读滚动容器
 * 的 offsetWidth/offsetHeight（jsdom 恒 0 → 可视区 0 行）。测试内对
 * [data-testid="session-scroll"] 打 offsetHeight=600 / offsetWidth=320 桩，
 * 其余元素保持 jsdom 原值。不 mock 虚拟库本身（要验证真实虚拟化行为）。
 * ResizeObserver 已由 src/test/setup.ts 全局桩（observe 空实现，不影响
 * 同步 getRect 路径）。
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
  AgentSessionListItem,
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  // task-04 scope 契约（2026-08-22-workspace-sessions-portal task-08 补测）：
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
  // D-003@v1 仅本人过滤：当前用户锚点（useSession 选择器入参状态）
  sessionUser: { id: "u-me" } as { id: string } | null,
  machinesHook: vi.fn(),
  machinesRefetch: vi.fn(),
}));

// 组件只消费三个列表函数（类型导入编译期擦除），局部 mock 不加载真实 daemon.ts。
vi.mock("@/lib/daemon", () => ({
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  listWorkspaceAgentSessions: (...args: unknown[]) =>
    mocks.listWorkspaceAgentSessions(...args),
  listChangeSessions: (...args: unknown[]) => mocks.listChangeSessions(...args),
}));

// task-08（D-003@v1）：scope 模式仅本人过滤经 useSession 取当前用户——
// mock 成可控用户（默认 u-me）。
vi.mock("@/stores/session", () => ({
  useSession: (selector: (_s: { user: { id: string } | null }) => unknown) =>
    selector({ user: mocks.sessionUser }),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

// ── jsdom 虚拟滚动桩：scroll 容器给出非零视口 ────────────────────────────

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
 * scope 端点瘦 item 固件（task-04 契约，对齐 daemon.ts AgentSessionListItem；
 * author 缺失场景传 `{ author: undefined }`——运行时旧数据形态，类型断言兜住）。
 */
function makeScopeItem(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    id: "s-own",
    provider: "claude",
    status: "active",
    turn_count: 3,
    mode: null,
    author: { user_id: "u-me", display_name: "我" },
    last_active_at: "2026-08-15T09:00:00Z",
    title: "我的会话",
    ...overrides,
  } as AgentSessionListItem;
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

/** 点引擎胶囊 tab（Segmented；chips 里也有引擎名，须在 .ant-segmented 内锚定）。 */
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

/** 当前渲染的会话行（虚拟滚动的可视区行）。 */
function sessionRows(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: /^会话 / });
}

function lastCallArgs(): Record<string, unknown> {
  const calls = mocks.listAgentSessions.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mocks.listAgentSessions.mockReset().mockResolvedValue(listResponse([]));
  // task-08：scope 两 API + 仅本人过滤用户锚点复位
  mocks.listWorkspaceAgentSessions.mockReset().mockResolvedValue([]);
  mocks.listChangeSessions.mockReset().mockResolvedValue([]);
  mocks.sessionUser = { id: "u-me" };
  setMachines();
  mocks.machinesRefetch.mockReset();
});

afterEach(() => {
  cleanup();
});

// ── 1. 默认查询 + 条目渲染 ───────────────────────────────────────────────

describe("SessionListPanel 初次渲染", () => {
  it("默认查询只带 limit；条目两行渲染（标题/状态点/相对时间/chips 读快照）", async () => {
    setMachines({
      items: [makeMachine({ id: "m-1", runtimes: [makeRuntime({ id: "rt-m1" })] })],
    });
    // 相对时间：last_active_at = 5 分钟前（避免时区歧义，相对 Date.now 构造）
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-1",
          title: "整理会议纪要",
          turn_count: 12,
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "会话 整理会议纪要" })).toBeInTheDocument();
    });
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 50 });

    // 第二行 chips：快照直显（免二次查询）+ 轮数
    const row = screen.getByRole("button", { name: "会话 整理会议纪要" });
    expect(row.textContent).toContain("🖥 DESKTOP-2BN7FDC");
    expect(row.textContent).toContain("Claude");
    expect(row.textContent).toContain("📋 知识经理");
    expect(row.textContent).toContain("☁ Kimi");
    expect(row.textContent).toContain("12 轮");
    // 第一行：状态点 + 相对时间
    expect(row.querySelector('[aria-label="状态 active"]')).toBeTruthy();
    expect(row.textContent).toContain("5 分钟前");
    // 头部总数
    expect(screen.getByText("共 1 个")).toBeInTheDocument();
  });
});

// ── 2/3. 引擎 tab + 状态下拉（选择型即查） ───────────────────────────────

describe("SessionListPanel 引擎/状态筛选", () => {
  it("点 Claude tab → 带 provider=claude 重新查询", async () => {
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    clickEngineTab("Claude");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({ limit: 50, provider: "claude" });
  });

  it("状态下拉选「已结束」→ 带 status=ended；「活跃」→ active", async () => {
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({ limit: 50, status: "ended" });

    await chooseAntdOptionByText("slp-status", "活跃");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(3));
    expect(lastCallArgs()).toEqual({ limit: 50, status: "active" });
  });
});

// ── 4. 机器筛选（单选 server 侧 / 多选客户端） ───────────────────────────

describe("SessionListPanel 机器筛选", () => {
  function threeMachines() {
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
      makeMachine({
        id: "m-3",
        hostname: "machine-3",
        status: "offline",
        runtimes: [makeRuntime({ id: "rt-m3" })],
      }),
    ];
  }

  it("单选 1 台 → machine_id 走 server 侧过滤", async () => {
    setMachines({ items: threeMachines() });
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    await chooseAntdOptionByText("slp-machine", "machine-2");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({ limit: 50, machine_id: "m-2" });
  });

  it("多选 2 台 → 不带 machine_id（后端单值装不下）+ 客户端过滤掉其它机器会话", async () => {
    setMachines({ items: threeMachines() });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-m1", runtime_id: "rt-m1", title: "会话一" }),
        makeSession({ id: "s-m2", runtime_id: "rt-m2", title: "会话二" }),
        makeSession({ id: "s-m3", runtime_id: "rt-m3", title: "会话三" }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    await waitFor(() => {
      expect(sessionRows().length).toBe(3);
    });

    await chooseAntdOptionByText("slp-machine", "machine-1");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({ limit: 50, machine_id: "m-1" });

    await chooseAntdOptionByText("slp-machine", "machine-2");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(3));
    // 多选：不下发 machine_id
    expect(lastCallArgs()).toEqual({ limit: 50 });
    // 客户端过滤：m-1/m-2 的会话保留，m-3 的「会话三」被滤掉
    const titles = sessionRows().map((r) => r.getAttribute("aria-label"));
    expect(titles).toContain("会话 会话一");
    expect(titles).toContain("会话 会话二");
    expect(titles).not.toContain("会话 会话三");
  });
});

// ── 5. 搜索回车触发 ──────────────────────────────────────────────────────

describe("SessionListPanel 标题搜索", () => {
  it("回车才触发 q；仅输入不触发新查询", async () => {
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("搜索会话标题");
    fireEvent.change(input, { target: { value: "会议" } });
    // 输入不触发（不每键查）
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({ limit: 50, q: "会议" });
  });
});

// ── 6. chips 快照缺省回退 + 离线划线 ─────────────────────────────────────

describe("SessionListPanel chips 快照与回退", () => {
  it("config_snapshot 为 null → 机器名回退机器映射、引擎回退 session.provider，无档案/供应商 chips", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-m1" })],
        }),
        makeMachine({
          id: "m-off",
          hostname: "machine-offline",
          status: "offline",
          runtimes: [makeRuntime({ id: "rt-off", provider: "codex" })],
        }),
      ],
    });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-old", runtime_id: "rt-m1", config_snapshot: null, title: "旧会话" }),
        makeSession({
          id: "s-off",
          runtime_id: "rt-off",
          provider: "codex",
          status: "ended",
          config_snapshot: null,
          title: "离线机会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "会话 旧会话" })).toBeInTheDocument();
    });
    const oldRow = screen.getByRole("button", { name: "会话 旧会话" });
    // 回退：机器名来自 runtime→机器映射；引擎来自 provider；无 📋/☁ chips
    expect(oldRow.textContent).toContain("🖥 machine-1");
    expect(oldRow.textContent).toContain("Claude");
    expect(oldRow.textContent).not.toContain("📋");
    expect(oldRow.textContent).not.toContain("☁");

    const offRow = screen.getByRole("button", { name: "会话 离线机会话" });
    // 引擎回退 codex + 离线机器 chip 划线（line-through）+（离线）
    expect(offRow.textContent).toContain("Codex");
    expect(offRow.textContent).toContain("（离线）");
    const machineChip = [...offRow.querySelectorAll(".ant-tag")].find((t) =>
      t.textContent?.includes("machine-offline"),
    );
    expect(machineChip?.className).toContain("line-through");
  });

  it("快照引擎字段优先于 session.provider（引擎切换过的旧会话）", async () => {
    setMachines({ items: [] });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          provider: "codex",
          config_snapshot: { engine: "claude", profile_name: null, provider_name: null, model: null, machine_name: "m1", agent_name: null },
          title: "快照会话",
        }),
      ]),
    );
    renderPanel(<SessionListPanel />);
    const row = await screen.findByRole("button", { name: "会话 快照会话" });
    expect(row.textContent).toContain("Claude");
  });
});

// ── 7. 点击回调 + 选中态 ─────────────────────────────────────────────────

describe("SessionListPanel 点击与选中态", () => {
  it("点击条目 → onSelect 回调带完整 session；selectedSessionId 对应行 aria-pressed=true", async () => {
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-1", title: "会话A" }),
        makeSession({ id: "s-2", title: "会话B" }),
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

// ── 8. 空态 / 错误态 ─────────────────────────────────────────────────────

describe("SessionListPanel 空态与错误态", () => {
  it("无会话 → 空态文案", async () => {
    mocks.listAgentSessions.mockResolvedValue(listResponse([]));
    renderPanel(<SessionListPanel />);
    await waitFor(() =>
      expect(screen.getByText("没有符合条件的会话")).toBeInTheDocument(),
    );
    expect(sessionRows().length).toBe(0);
  });

  it("查询失败 → 错误条 + 重新加载", async () => {
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

// ── 9. 虚拟滚动只渲染可视区 ──────────────────────────────────────────────

describe("SessionListPanel 虚拟滚动（D-003）", () => {
  it("80 条会话单页 → 只渲染可视区行（≪ 总数），滚动容器 mount", async () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      makeSession({ id: `s-${i}`, title: `批量会话${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(many, { total: 80 }));
    renderPanel(<SessionListPanel />);

    await waitFor(() => {
      expect(sessionRows().length).toBeGreaterThan(0);
    });
    expect(document.querySelector('[data-testid="session-scroll"]')).toBeTruthy();
    const rendered = sessionRows().length;
    // 视口 600px / 行高 64 ≈ 10 行 + overscan 6 → 远小于 80
    expect(rendered).toBeLessThan(30);
    // 且渲染的是连续的首屏条目（从 0 开始）
    expect(
      screen.queryByRole("button", { name: "会话 批量会话0" }),
    ).toBeInTheDocument();
  });
});

// ── 10. 加载更多（后端真分页，R-04） ─────────────────────────────────────

describe("SessionListPanel 加载更多", () => {
  it("total > 已加载 → 显示按钮；点击后 offset 递增取下一页", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      makeSession({ id: `p1-${i}`, title: `第一页${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(page1, { total: 60 }));
    renderPanel(<SessionListPanel />);

    const moreBtn = await screen.findByRole("button", { name: /加载更多/ });
    expect(moreBtn.textContent).toContain("50/60");

    const page2 = Array.from({ length: 10 }, (_, i) =>
      makeSession({ id: `p2-${i}`, title: `第二页${i}` }),
    );
    mocks.listAgentSessions.mockResolvedValue(listResponse(page2, { total: 60 }));
    fireEvent.click(moreBtn);

    await waitFor(() =>
      expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2),
    );
    expect(lastCallArgs()).toMatchObject({ limit: 50, offset: 50 });
  });
});

// ── 11/12/13. workspace scope（task-04 / FR-04 / D-003@v1，QA §4.F 直接断言） ──
//
// 核心语义此前的落点在 sessions-portal.test.tsx（门户集成），此处补组件级
// 直接断言。缺省（不传 scope）全局路径回归由 §1「初次渲染默认查询」既有
// 用例覆盖（真分页/加载更多另见 §10），不重复。

const WORKSPACE_SCOPE: SessionListScope = {
  kind: "workspace",
  workspaceId: "ws-1",
};

describe("SessionListPanel workspace scope 数据源与仅本人过滤（D-003@v1）", () => {
  it("走 listWorkspaceAgentSessions(ws, include_ended=true) 且 listAgentSessions 零调用；他人会话剔除、author 缺失保留", async () => {
    // 跨成员返回固件：本人 + 他人 + author 缺失（旧数据）三条
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      makeScopeItem({ id: "s-own-1", title: "我的会议纪要" }),
      makeScopeItem({
        id: "s-other",
        title: "同事的会话",
        author: { user_id: "u-other", display_name: "张三" },
      }),
      makeScopeItem({ id: "s-legacy", title: "旧数据会话", author: undefined }),
    ]);
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    expect(
      await screen.findByRole("button", { name: "会话 我的会议纪要" }),
    ).toBeInTheDocument();
    // 数据源：workspace 端点带 include_ended=true；全局/变更端点零调用
    expect(mocks.listWorkspaceAgentSessions).toHaveBeenCalledTimes(1);
    expect(mocks.listWorkspaceAgentSessions).toHaveBeenCalledWith("ws-1", {
      include_ended: true,
    });
    expect(mocks.listAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();

    // 仅本人过滤（Grill P0-1）：attach 端点 owner-only → 他人会话剔除；
    // author 缺失（旧数据）视为本人保留
    expect(
      screen.getByRole("button", { name: "会话 旧数据会话" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "会话 同事的会话" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });
});

describe("SessionListPanel workspace scope 筛选条降级与本地搜索（Grill P1-2）", () => {
  it("状态/机器/引擎三控件不渲染；标题搜索回车客户端过滤（不重查）；「加载更多」不出现", async () => {
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      makeScopeItem({ id: "s-a", title: "会议纪要整理" }),
      makeScopeItem({ id: "s-b", title: "代码评审记录" }),
    ]);
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    await waitFor(() => expect(sessionRows().length).toBe(2));

    // 服务端筛选三控件隐藏（两 scope 端点不收这些参数）
    expect(document.getElementById("slp-status")).toBeNull();
    expect(document.getElementById("slp-machine")).toBeNull();
    expect(document.querySelector(".ant-segmented")).toBeNull();

    // 本地标题搜索仍可用：回车 → 客户端过滤
    const input = screen.getByLabelText("搜索会话标题");
    fireEvent.change(input, { target: { value: "会议" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "会话 会议纪要整理" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "会话 代码评审记录" }),
    ).not.toBeInTheDocument();
    // scope queryKey 不含 q → 客户端过滤不触发重查
    expect(mocks.listWorkspaceAgentSessions).toHaveBeenCalledTimes(1);

    // 整列单页合成（getNextPageParam 恒 undefined）→ 无「加载更多」
    expect(
      screen.queryByRole("button", { name: /加载更多/ }),
    ).not.toBeInTheDocument();
  });
});

describe("SessionListPanel workspace scope 瘦字段降级（Grill P1-1 / design §4.B）", () => {
  it("条目无 runtime_id/config_snapshot → 机器名/档案名/供应商 chips 不渲染；时间列相对时间或 —", async () => {
    // 机器在线存在：若实现错误回退 runtime→机器映射会渲染出 machine-1，
    // 以此反证瘦字段路径真正跳过机器 chip。
    setMachines({
      items: [makeMachine({ id: "m-1", hostname: "machine-1" })],
    });
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      makeScopeItem({
        id: "s-thin",
        title: "瘦字段会话",
        last_active_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
      makeScopeItem({ id: "s-notime", title: "无时间会话", last_active_at: null }),
    ]);
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    const thin = await screen.findByRole("button", { name: "会话 瘦字段会话" });
    // 有时间：相对时间 + 引擎/轮数照常；机器/档案/供应商 chips 缺席
    expect(thin.textContent).toContain("5 分钟前");
    expect(thin.textContent).toContain("Claude");
    expect(thin.textContent).toContain("3 轮");
    expect(thin.textContent).not.toContain("🖥");
    expect(thin.textContent).not.toContain("machine-1");
    expect(thin.textContent).not.toContain("📋");
    expect(thin.textContent).not.toContain("☁");

    // 无时间（last_active_at=null → created_at 兜底 "" → 空值统一 —）
    const notime = screen.getByRole("button", { name: "会话 无时间会话" });
    expect(notime.textContent).toContain("—");
  });
});
