/**
 * task-14 / FR-01 / FR-04 / D-004@v1: runtimes 页用量区 + 时间窗切换单测。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-06-24-runtime-usage-stats/tasks/task-15.md
 *     §frontend page-usage.test.tsx(4 数字 k/M 格式化 + 切窗同步 + codex「—」+ loading)
 *   - design.md §5 卡片 4 数字 + sparkline(FR-01)、时间窗切换(FR-04)
 *   - decisions.md D-001@v1(codex 无 cache 显示「—」)/D-004@v1(非实时,切窗拉取)
 *
 * 覆盖:
 *   1. 卡片显示输入/输出/缓存/费用 4 数字(AC-01)
 *   2. token k/M 格式化(999→999 / 1500→1.5k / 1500000→1.5M)
 *   3. 时间窗切窗触发 getRuntimesUsage 重拉 + 数字/图同步(AC-02)
 *   4. codex 无 cache → 缓存项显示「—」(D-001@v1/AC-05)
 *   5. loading=true 显示「加载中」(AC-07 子项)
 *
 * 测试模式:照搬 runtimes/page.test.tsx 的 mock 脚手架(vi.hoisted +
 * vi.importActual + next/navigation mock + EventSource stub + useSession.setState),
 * 补 getRuntimesUsage mock。组件层不直接验 echarts canvas,只断言 DOM 文本同步。
 */

import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";

import RuntimesPage from "@/app/(dashboard)/runtimes/page";
import { useSession } from "@/stores/session";
import type { RuntimeUsageItem, RuntimeUsageResponse } from "@/lib/daemon";

// task-07：page 顶层调 useNotify() + App.useApp()（task-06 改 antd Modal.confirm +
// message toast）。App.useApp() 需 <AntApp> Context 才能拿到真实实例（否则 modal 为
// 空对象，删除流程 modal.confirm 会崩）。renderPage 统一包裹。
function renderPage(ui: React.ReactElement) {
  return render(<AntApp>{ui}</AntApp>);
}

// ── next/navigation mock(切窗不走路由,但 page mount 用 useSearchParams/useRouter) ──

const nav = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

// ── mocks:照搬 page.test.tsx,补 getRuntimesUsage ────────────────────────────

const daemon = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  deleteDaemonRuntime: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  getAgentSession: vi.fn(),
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
  getRuntimesUsage: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemon.listDaemonRuntimes,
    // task-07：page 列表数据源改 listDaemonRuntimesPage；包装 mock 无需改 mockResolvedValue。
    listDaemonRuntimesPage: vi.fn(async (params?: { limit?: number; offset?: number }) => {
      const items = await daemon.listDaemonRuntimes();
      return {
        items,
        total: items.length,
        limit: params?.limit ?? 12,
        offset: params?.offset ?? 0,
      };
    }),
    updateDaemonRuntime: vi.fn(),
    listAgentSessions: daemon.listAgentSessions,
    deleteAgentSession: daemon.deleteAgentSession,
    deleteDaemonRuntime: daemon.deleteDaemonRuntime,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    getAgentSession: daemon.getAgentSession,
    reopenSession: daemon.reopenSession,
    streamSession: daemon.streamSession,
    getRuntimesUsage: daemon.getRuntimesUsage,
  };
});

// EventSource stub(page mount 不直接用,但 dialog 依赖;保持与 page.test.tsx 一致)
class FakeES {
  url: string;
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(kind: string, cb: (e: { data: string }) => void) {
    (this.listeners[kind] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {}
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    id: "rt-1",
    name: "daemon",
    provider: "claude",
    version: "1.0.0",
    status: "online",
    last_heartbeat_at: "2026-06-24T10:00:00Z",
    capabilities: { protocol: "ws", agents: ["claude"] },
    allowed_roots: [],
    created_at: "2026-06-24T09:00:00Z",
    updated_at: "2026-06-24T10:00:00Z",
    ...overrides,
  };
}

function makeUsageItem(
  runtime_id: string,
  summary: Record<string, number>,
  daily: Array<Record<string, unknown>> = [],
): RuntimeUsageItem {
  return {
    runtime_id,
    summary: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: 0,
      ...summary,
    },
    daily: daily.map((d) => ({
      ts: "2026-06-24T00:00:00Z",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: 0,
      ...d,
    })),
  };
}

function usageResponse(
  window: "1d" | "7d" | "30d",
  runtimes: RuntimeUsageItem[],
): RuntimeUsageResponse {
  return { window, runtimes };
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  vi.stubGlobal("EventSource", FakeES);
  // task-07：删除 vi.stubGlobal("confirm", ...) —— task-06 已改用 antd Modal.confirm。
  nav.searchParams = new URLSearchParams();
  nav.replace = vi.fn();
  daemon.listDaemonRuntimes.mockResolvedValue([]);
  daemon.listAgentSessions.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  daemon.deleteAgentSession.mockResolvedValue(undefined);
  daemon.deleteDaemonRuntime.mockResolvedValue(undefined);
  daemon.getAgentSessionLogs.mockResolvedValue([]);
  daemon.reopenSession.mockResolvedValue({ session_id: "stub", status: "reconnecting" });
  daemon.getAgentSession.mockResolvedValue({
    id: "stub",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "reconnecting",
    agent_session_id: "ag",
    config: null,
    turn_count: 0,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
  });
  daemon.streamSession.mockImplementation(() => ({
    close: () => {},
    getLastEventId: () => null,
  }));
  // getRuntimesUsage 默认空响应(7d 窗,无 runtime 数据)
  daemon.getRuntimesUsage.mockResolvedValue(usageResponse("7d", []));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 渲染并等用量统计区出现(卡片标题「用量统计(7 天)」)。 */
async function renderAndWaitForUsage() {
  const utils = renderPage(<RuntimesPage />);
  await waitFor(() => {
    expect(daemon.getRuntimesUsage).toHaveBeenCalled();
  });
  return utils;
}

/** 定位指定 runtime 卡片的用量区(用 article + h3 name 缩小作用域,避免多卡片串扰)。 */
async function findUsageSectionByName(name: string) {
  const heading = await screen.findByText(name);
  // h3 在 header,向上找 article,再向下找用量统计区
  const article = heading.closest("article");
  expect(article, `runtime 卡片 ${name} 的 article 未找到`).not.toBeNull();
  return article as HTMLElement;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("task-14 / FR-01: 卡片用量区 4 数字(AC-01)", () => {
  it("显示输入/输出/缓存/费用 4 数字(token k/M 格式化 + $USD)", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-a", name: "MyClaude" })]);
    daemon.getRuntimesUsage.mockResolvedValue(
      usageResponse("7d", [
        makeUsageItem("rt-a", {
          input_tokens: 7_800_000,
          output_tokens: 1_500_000,
          cache_read_tokens: 36_000_000,
          total_cost_usd: 81.2,
        }),
      ]),
    );

    await renderAndWaitForUsage();
    const card = await findUsageSectionByName("MyClaude");

    // k/M 格式化:7.8M / 1.5M / 36.0M / $81.20
    expect(within(card).getByText("7.8M")).toBeInTheDocument();
    expect(within(card).getByText("1.5M")).toBeInTheDocument();
    expect(within(card).getByText("36.0M")).toBeInTheDocument();
    expect(within(card).getByText("$81.20")).toBeInTheDocument();
  });

  it("token k/M 格式化边界:< 1000 原值 / >= 1000 → k / >= 1e6 → M", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-b", name: "EdgeClaude" })]);
    daemon.getRuntimesUsage.mockResolvedValue(
      usageResponse("7d", [
        makeUsageItem("rt-b", {
          // 输入 999(原值)/ 输出 1500(1.5k)/ 缓存合并 1500000(1.5M)/ 费用 0
          input_tokens: 999,
          output_tokens: 1500,
          cache_read_tokens: 1500000,
          cache_creation_tokens: 0,
          total_cost_usd: 0,
        }),
      ]),
    );

    await renderAndWaitForUsage();
    const card = await findUsageSectionByName("EdgeClaude");

    expect(within(card).getByText("999")).toBeInTheDocument(); // < 1000 原值
    expect(within(card).getByText("1.5k")).toBeInTheDocument(); // 1500 → 1.5k
    expect(within(card).getByText("1.5M")).toBeInTheDocument(); // 1500000 → 1.5M
    expect(within(card).getByText("$0.00")).toBeInTheDocument(); // 0 → $0.00
  });

  it("usage=undefined(新 runtime / 拉取失败)→ 数字全「—」、费用 $0.00", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-new", name: "Fresh" })]);
    // getRuntimesUsage 返回空(不含 rt-new)→ usage=undefined
    daemon.getRuntimesUsage.mockResolvedValue(usageResponse("7d", []));

    await renderAndWaitForUsage();
    const card = await findUsageSectionByName("Fresh");

    // input/output/cache 三项「—」,cost $0.00(summary undefined 分支)
    const dashes = within(card).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3); // input/output/cache 至少 3 个「—」
    expect(within(card).getByText("$0.00")).toBeInTheDocument();
  });
});

describe("task-14 / FR-04: 时间窗切换(AC-02)", () => {
  it("初始默认 7d,getRuntimesUsage 被以 '7d' 调用", async () => {
    await renderAndWaitForUsage();
    expect(daemon.getRuntimesUsage).toHaveBeenCalledWith("7d");
  });

  it("点「当日」tab → getRuntimesUsage 以 '1d' 再调一次(切窗重拉)", async () => {
    // 注:必须 mock 至少 1 个 runtime,否则 listDaemonRuntimes=[] → 页面渲染 EmptyState,
    // 时间窗切换器(section 内)不渲染,findByRole 找不到「切换用量统计时间窗为当日」按钮。
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-switch", name: "SwitchClaude" })]);
    daemon.getRuntimesUsage.mockResolvedValue(usageResponse("7d", []));
    await renderAndWaitForUsage();
    expect(daemon.getRuntimesUsage).toHaveBeenCalledWith("7d");

    // 点「当日」tab(切到 1d)
    const todayBtn = await screen.findByRole("button", { name: /切换用量统计时间窗为当日/ });
    fireEvent.click(todayBtn);

    await waitFor(() => {
      expect(daemon.getRuntimesUsage).toHaveBeenCalledWith("1d");
    });
  });

  it("切窗后卡片数字同步刷新(getRuntimesUsage 新返回值反映在 DOM)", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-c", name: "SyncClaude" })]);
    // 初始 7d:输入 1000(1.0k)
    daemon.getRuntimesUsage.mockResolvedValueOnce(
      usageResponse("7d", [
        makeUsageItem("rt-c", { input_tokens: 1000 }),
      ]),
    );
    // 切到 1d:输入 2000(2.0k)
    daemon.getRuntimesUsage.mockResolvedValueOnce(
      usageResponse("1d", [
        makeUsageItem("rt-c", { input_tokens: 2000 }),
      ]),
    );

    await renderAndWaitForUsage();
    const card = await findUsageSectionByName("SyncClaude");
    expect(within(card).getByText("1.0k")).toBeInTheDocument();

    // 切到「当日」
    const todayBtn = await screen.findByRole("button", { name: /切换用量统计时间窗为当日/ });
    fireEvent.click(todayBtn);

    // 数字同步更新为 2.0k
    await waitFor(() => {
      expect(within(card).getByText("2.0k")).toBeInTheDocument();
    });
  });

  it("时间窗标题随窗变化(用量统计(7 天) → 用量统计(当日))", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-d", name: "LabelClaude" })]);
    daemon.getRuntimesUsage.mockResolvedValue(
      usageResponse("7d", [makeUsageItem("rt-d", { input_tokens: 100 })]),
    );

    await renderAndWaitForUsage();
    expect(screen.getAllByText(/用量统计（7 天）/).length).toBeGreaterThan(0);

    const todayBtn = await screen.findByRole("button", { name: /切换用量统计时间窗为当日/ });
    fireEvent.click(todayBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/用量统计（当日）/).length).toBeGreaterThan(0);
    });
  });
});

describe("task-14 / D-001@v1: codex 无 cache 显示「—」(AC-05)", () => {
  it("codex 系 cache_read/creation 均 0 → 缓存项显示「—」(非 0)", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({ id: "rt-codex", name: "CodexAgent", provider: "codex" }),
    ]);
    daemon.getRuntimesUsage.mockResolvedValue(
      usageResponse("7d", [
        makeUsageItem("rt-codex", {
          input_tokens: 5000,
          output_tokens: 1000,
          cache_read_tokens: 0, // codex 无 prompt cache
          cache_creation_tokens: 0,
          total_cost_usd: 2.5,
        }),
      ]),
    );

    await renderAndWaitForUsage();
    const card = await findUsageSectionByName("CodexAgent");

    // input/output 正常显示(5.0k / 1.0k),cost $2.50
    expect(within(card).getByText("5.0k")).toBeInTheDocument();
    expect(within(card).getByText("1.0k")).toBeInTheDocument();
    expect(within(card).getByText("$2.50")).toBeInTheDocument();

    // 缓存项显示「—」(cache_read+creation=0 → formatCache 返回「—」)
    // 注意:卡片内可能有多个「—」(usage 缺失场景),但此场景 summary 非 undefined,
    // 只有缓存项一个「—」
    expect(within(card).getByText("—")).toBeInTheDocument();
    // 缓存格(UsageStat 的 value <p>)不应显示误导性的「0」。
    // 限定到 <p> 标签:UsageStat value 渲染为 <p class="...text-sm font-semibold...">,
    // 避免误匹配 sessionStats.total 的 <span>0</span>(active=0 时该 span 文本就是「0」,
    // class 为 "inline-flex items-center gap-1",结构不同)。
    expect(within(card).queryByText(/^0$/, { selector: "p.text-sm.font-semibold" })).not.toBeInTheDocument();
  });

  it("claude 系有 cache → 缓存项显示合并值(read+creation)", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({ id: "rt-claude", name: "ClaudeAgent", provider: "claude" }),
    ]);
    daemon.getRuntimesUsage.mockResolvedValue(
      usageResponse("7d", [
        makeUsageItem("rt-claude", {
          cache_read_tokens: 30000,
          cache_creation_tokens: 5000,
        }),
      ]),
    );

    await renderAndWaitForUsage();
    const card = await findUsageSectionByName("ClaudeAgent");

    // 合并 35000 → 35.0k
    expect(within(card).getByText("35.0k")).toBeInTheDocument();
    // 无「—」(cache 有值)
    expect(within(card).queryByText("—")).not.toBeInTheDocument();
  });
});

describe("task-14 / FR-04: loading 态(AC-07 子项)", () => {
  it("getRuntimesUsage pending → 卡片显示「加载中」", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-l", name: "LoadClaude" })]);
    // pending:永不 resolve(测试内不 advance)
    daemon.getRuntimesUsage.mockImplementation(
      () => new Promise<RuntimeUsageResponse>(() => {}),
    );

    await renderPage(<RuntimesPage />);
    // 等 listDaemonRuntimes resolve + getRuntimesUsage 被调(loading=true)
    await waitFor(() => expect(daemon.getRuntimesUsage).toHaveBeenCalled());
    // 用量区显示「加载中」(usageLoading=true)
    await waitFor(() => {
      expect(screen.getAllByText("加载中").length).toBeGreaterThan(0);
    });
  });
});
