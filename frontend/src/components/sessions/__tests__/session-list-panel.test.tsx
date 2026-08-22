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
 *   11. workspace/change scope 数据源（2026-08-22-workspace-sessions-portal
 *      task-11 v3 返工 / D-003@v2）：走全局端点 listAgentSessions 带过滤参
 *      （workspace 只传 workspace_id；change 双传 workspace_id+change_id），
 *      v2 两 scope 端点（listWorkspaceAgentSessions/listChangeSessions）零调用
 *   12. scope 筛选条渲染（Grill P1-2 v3 反转）：状态/机器/引擎三控件在
 *      scope 模式照常渲染（v2 隐藏特例已删），筛选照常走服务端参数
 *      （scope 过滤参 + 筛选参同传，与全局同构）
 *   13. scope 全字段渲染 + 端点过滤（Grill P1-1 / D-003@v2）：喂
 *      AgentSessionRead 全字段形状 → chips（机器/引擎/档案/供应商）+
 *      相对时间照常渲染（v2 瘦字段降级已删）；他人会话由端点过滤——
 *      mock 返回什么显示什么（v2 客户端仅本人过滤已删）
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
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  // v2 两 scope 端点保留 mock 仅为 D-003@v2 零调用断言（数据源已切全局端点）。
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
  machinesHook: vi.fn(),
  machinesRefetch: vi.fn(),
}));

// 组件只消费 listAgentSessions（类型导入编译期擦除），局部 mock 不加载真实
// daemon.ts；两 scope 端点 mock 供零调用断言。
vi.mock("@/lib/daemon", () => ({
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  listWorkspaceAgentSessions: (...args: unknown[]) =>
    mocks.listWorkspaceAgentSessions(...args),
  listChangeSessions: (...args: unknown[]) => mocks.listChangeSessions(...args),
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
  // D-003@v2：两 scope 端点仅剩零调用断言用途
  mocks.listWorkspaceAgentSessions.mockReset().mockResolvedValue([]);
  mocks.listChangeSessions.mockReset().mockResolvedValue([]);
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

// ── 11/12/13. scope 用例（task-11 v3 返工 / D-003@v2，QA §4.F 直接断言） ──
//
// 核心语义此前的落点在 sessions-portal.test.tsx（门户集成），此处补组件级
// 直接断言。缺省（不传 scope）全局路径回归由 §1「初次渲染默认查询」既有
// 用例覆盖（真分页/加载更多另见 §10），不重复。

const WORKSPACE_SCOPE: SessionListScope = {
  kind: "workspace",
  workspaceId: "ws-1",
};
const CHANGE_SCOPE: SessionListScope = {
  kind: "change",
  workspaceId: "ws-1",
  changeId: "chg-1",
};

describe("SessionListPanel scope 数据源切全局端点（D-003@v2）", () => {
  it("workspace scope：listAgentSessions 带 workspace_id（单参）；v2 两 scope 端点零调用", async () => {
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-ws", title: "工作区会话" })]),
    );
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    expect(
      await screen.findByRole("button", { name: "会话 工作区会话" }),
    ).toBeInTheDocument();
    // 数据源（v3 反转）：全局端点 + workspace_id 过滤参（含既有 limit）
    expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1);
    expect(lastCallArgs()).toEqual({ limit: 50, workspace_id: "ws-1" });
    expect(mocks.listWorkspaceAgentSessions).not.toHaveBeenCalled();
    expect(mocks.listChangeSessions).not.toHaveBeenCalled();
  });

  it("change scope：listAgentSessions workspace_id + change_id 双传（change 隐含 workspace）", async () => {
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-chg", title: "变更会话" })]),
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
  });

  it("他人会话由端点过滤：mock 返回什么显示什么（客户端零过滤，v2 仅本人过滤已删）", async () => {
    // D-003@v2：owner 隔离 + scope 过滤都是端点 SQL 层职责，前端透传过滤参
    // 即完成；列表对端点返回的条目原样渲染（user_id ≠ 当前用户也不剔除）。
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({ id: "s-own", title: "我的会话", user_id: "u-me" }),
        makeSession({
          id: "s-other",
          title: "同事的会话",
          user_id: "u-other",
        }),
      ]),
    );
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    expect(
      await screen.findByRole("button", { name: "会话 我的会话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "会话 同事的会话" }),
    ).toBeInTheDocument();
    // 过滤参已透传（端点职责），客户端计数 = 端点返回 total
    expect(lastCallArgs()).toEqual({ limit: 50, workspace_id: "ws-1" });
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });
});

describe("SessionListPanel scope 筛选条渲染（Grill P1-2 v3 反转）", () => {
  it("状态/机器/引擎三控件在 scope 模式照常渲染；服务端筛选照常带参（与全局同构）", async () => {
    setMachines({
      items: [
        makeMachine({ id: "m-1", runtimes: [makeRuntime({ id: "rt-m1" })] }),
      ],
    });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-ws", title: "工作区会话" })]),
    );
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(1));

    // 三控件渲染（v3：v2 的 scope 隐藏特例已删）
    expect(document.getElementById("slp-status")).not.toBeNull();
    expect(document.getElementById("slp-machine")).not.toBeNull();
    expect(document.querySelector(".ant-segmented")).not.toBeNull();

    // 服务端筛选照常：scope 过滤参 + 筛选参同传
    await chooseAntdOptionByText("slp-status", "已结束");
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalledTimes(2));
    expect(lastCallArgs()).toEqual({
      limit: 50,
      workspace_id: "ws-1",
      status: "ended",
    });
  });
});

describe("SessionListPanel scope 全字段渲染（Grill P1-1 v3 反转 / D-003@v2）", () => {
  it("喂 AgentSessionRead 全字段形状 → chips（机器/引擎/档案/供应商）+ 相对时间 + 轮数照常渲染", async () => {
    // v2 瘦字段降级已删：全局端点返回全字段，scope 模式与全局渲染零差异。
    // （机器名读 config_snapshot 直显，机器列表留空以证明不依赖回退映射。）
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([
        makeSession({
          id: "s-full",
          title: "全字段会话",
          workspace_id: "ws-1",
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
      ]),
    );
    renderPanel(<SessionListPanel scope={WORKSPACE_SCOPE} />);

    const row = await screen.findByRole("button", { name: "会话 全字段会话" });
    // chips 全量直显 + 相对时间（v2 用例断言的「缺席」反转为「在场」）
    expect(row.textContent).toContain("🖥 DESKTOP-2BN7FDC");
    expect(row.textContent).toContain("Claude");
    expect(row.textContent).toContain("📋 知识经理");
    expect(row.textContent).toContain("☁ Kimi");
    expect(row.textContent).toContain("7 轮");
    expect(row.textContent).toContain("5 分钟前");
    // 后端 total 照常显示（非 v2 客户端合成计数）
    expect(screen.getByText("共 1 个")).toBeInTheDocument();
  });
});
