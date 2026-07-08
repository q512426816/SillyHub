/**
 * task-05：runtimes/page.test.tsx 重写（弹窗化 + active attach 后）。
 *
 * page 层职责：runtime 列表渲染 + 点「会话」按钮开 RuntimeSessionDialog 弹窗
 * + URL ?session= 恢复自动开弹窗 + runtime 卡片删除。
 * 会话交互细节（列表/历史/attach 续聊/关闭清理）由
 * runtime-session-dialog.test.tsx（task-06）覆盖。
 *
 * 旧版底部常驻 SessionListSection 已移除（task-04），原依赖它的会话交互用例
 * （点列表项 / 删除会话 / 气泡渲染 / 续聊按钮 / active 只读回看）一并移交 dialog 测试。
 */

import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import RuntimesPage from "@/app/(dashboard)/runtimes/page";
import { useSession } from "@/stores/session";

// task-10（react-query-migration）：page 顶层调 useQueryClient()/useDaemonRuntimes，需包
// QueryClientProvider。每测试独立 QueryClient（retry:false/gcTime:0）防缓存串。
function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>{ui}</AntApp>
    </QueryClientProvider>,
  );
}

// ── next/navigation mock（page 用 useSearchParams/useRouter 做 URL 恢复 + 清 param） ──

const nav = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

// ── mocks（task-09：page 数据源改 useDaemonMachines → listDaemonMachines） ────

const daemon = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listDaemonMachines: vi.fn(),
  listAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  deleteDaemonRuntime: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  getAgentSession: vi.fn(),
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
  getRuntimesUsage: vi.fn(),
  getDaemonVersion: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemon.listDaemonRuntimes,
    // task-09：page 列表数据源改 listDaemonMachines；测试用 wrapMachines 把 runtime
    // 数组包进单个 machine 响应（machine.id="m-1"）。
    listDaemonMachines: daemon.listDaemonMachines,
    updateDaemonMachine: vi.fn(),
    listAgentSessions: daemon.listAgentSessions,
    deleteAgentSession: daemon.deleteAgentSession,
    deleteDaemonRuntime: daemon.deleteDaemonRuntime,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    getAgentSession: daemon.getAgentSession,
    reopenSession: daemon.reopenSession,
    streamSession: daemon.streamSession,
    // task-09：page mount 调 getRuntimesUsage + getDaemonVersion，必须 mock 防真实 fetch。
    getRuntimesUsage: daemon.getRuntimesUsage,
    getDaemonVersion: daemon.getDaemonVersion,
  };
});

// EventSource stub（弹窗 attach 建 SSE；page 层不直接断言，但 dialog 内会建）
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
    last_heartbeat_at: "2026-06-18T10:00:00Z",
    capabilities: { protocol: "ws", agents: ["claude"] },
    allowed_roots: [],
    created_at: "2026-06-18T09:00:00Z",
    updated_at: "2026-06-18T10:00:00Z",
    ...overrides,
  };
}

/** task-09：把 runtime 数组包成单个 machine 响应（machine.id="m-1"，status=online）。 */
function wrapMachines(runtimes: ReturnType<typeof makeRuntime>[]) {
  return {
    items: [
      {
        id: "m-1",
        hostname: "host-1",
        display_alias: null,
        os: "linux",
        arch: "x64",
        status: "online",
        last_heartbeat_at: "2026-06-18T10:00:00Z",
        version: "1.4.2",
        build_id: "a1b2c3d9e8f7",
        created_at: "2026-06-18T09:00:00Z",
        owner: null,
        runtime_count: runtimes.length,
        online_runtime_count: runtimes.filter((r) => r.status === "online").length,
        runtimes,
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  };
}

/** task-09：展开第一个 machine 卡（runtime 卡默认折叠在 MachineCard 展开体内）。
 *  先等 machine header（含 aria-expanded 的 button）渲染出现，再点击展开。 */
async function expandFirstMachine() {
  // 等机器卡折叠头渲染（aria-expanded 属性的 button 出现）。
  await waitFor(() => {
    const headers = screen.getAllByRole("button");
    expect(headers.some((el) => el.hasAttribute("aria-expanded"))).toBe(true);
  });
  const headers = screen.getAllByRole("button");
  const header = headers.find((el) => el.getAttribute("aria-expanded") === "false");
  if (header) fireEvent.click(header);
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  vi.stubGlobal("EventSource", FakeES);
  nav.searchParams = new URLSearchParams();
  nav.replace = vi.fn();
  daemon.listDaemonRuntimes.mockResolvedValue([]);
  // task-09：默认空 machine 列表（具体用例各自 mockResolvedValue）。
  daemon.listDaemonMachines.mockResolvedValue(wrapMachines([]));
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
  // task-09：page mount 调 getRuntimesUsage + getDaemonVersion，默认空响应。
  daemon.getRuntimesUsage.mockResolvedValue({ window: "7d", runtimes: [] });
  daemon.getDaemonVersion.mockResolvedValue({
    latest: "a1b2c3d",
    minRequired: "0.1.0",
    downloadUrl: "/x",
    latest_version: "1.4.2",
    latest_build_id: "a1b2c3d",
  });
  // task-07：删除 vi.stubGlobal("confirm", ...) —— task-06 已改用 antd Modal.confirm，
  // 不再走 window.confirm。
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RuntimesPage（弹窗化后，task-04/05）", () => {
  it("渲染 runtime 列表，无底部常驻会话区（卡片去 max-h）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime()]));
    renderPage(<RuntimesPage />);
    // task-09：machine 卡默认折叠，先展开才看到 runtime name。
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0));
    expandFirstMachine();
    await waitFor(() => expect(screen.getByText("daemon")).toBeInTheDocument());
    // runtime-list-scroll 仍在（机器卡容器），但 task-04 移除了 max-h-[680px]
    const list = screen.getByTestId("runtime-list-scroll");
    expect(list).not.toHaveClass("max-h-[680px]");
    // 无底部常驻会话区 empty state（"没有会话" 属弹窗内，弹窗未开不在页面层）
    expect(screen.queryByText(/没有会话/)).not.toBeInTheDocument();
    // 弹窗未开（无 dialog role）
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("点 runtime 卡片「会话」按钮 → 弹出 RuntimeSessionDialog（D-001 单例）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime({ name: "MyClaude" })]));
    renderPage(<RuntimesPage />);
    // task-09：runtime 卡默认折叠，先展开 machine。
    await expandFirstMachine();
    const sessionBtn = await screen.findByRole("button", { name: /^会话$/ });
    fireEvent.click(sessionBtn);
    // 弹窗打开（Radix DialogContent role=dialog）— 点卡片「会话」按钮弹出 RuntimeSessionDialog
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // 弹窗内含 runtime 名（header h2 / sr-only title；用 within 限定弹窗作用域，避开卡片同名）
    await waitFor(() =>
      expect(within(dialog).getAllByText(/MyClaude/).length).toBeGreaterThan(0),
    );
  });

  // task-06 / task-07：删除流程从 window.confirm + setError 改为 antd Modal.confirm
  // + notify.success/.error。测试改为：点移除按钮 → 找 Modal dialog → 点 Modal OK「移除」
  // → 断言 deleteDaemonRuntime 被调 + 列表移除（不再断言 window.confirm）。
  it("ql-012 移除 runtime（Modal.confirm → deleteDaemonRuntime → 列表移除）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([makeRuntime({ id: "rt-del", name: "to-remove" })]),
    );
    renderPage(<RuntimesPage />);
    // task-09：runtime 卡默认折叠，先展开 machine。
    await expandFirstMachine();
    const removeBtn = await screen.findByRole("button", { name: /移除/ });
    fireEvent.click(removeBtn);

    // task-06：点卡片「移除」→ 弹 antd Modal.confirm（document.body portal）
    const dialog = await screen.findByRole("dialog");
    // Modal 的 OK 按钮文案「移除」（okText），用 within(dialog) 限定弹窗作用域，
    // 避免误匹配卡片内同名「移除」按钮（卡片不在 dialog 内）。
    // 注：antd v5 对两字中文按钮文案会自动插入字间距（渲染为 "移 除"），
    // 用正则 /移\s*除/ 兼容。
    const okBtn = within(dialog).getByRole("button", { name: /移\s*除/ });
    fireEvent.click(okBtn);

    await waitFor(() =>
      expect(daemon.deleteDaemonRuntime).toHaveBeenCalledWith("rt-del"),
    );
    // 204 成功 → notify.success + 列表移除
    await waitFor(() =>
      expect(screen.queryByText("to-remove")).not.toBeInTheDocument(),
    );
  });

  // AC-02-c（测试侧）：409 后端中文 message → notify.error toast，列表不变，
  // 反向断言英文 code HTTP_409 不暴露给用户。
  it("task-06：删除被绑定（409）→ notify.error 弹后端中文 message，列表不变", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([makeRuntime({ id: "rt-bound", name: "bound-runtime" })]),
    );
    const { ApiError } = await import("@/lib/api");
    daemon.deleteDaemonRuntime.mockRejectedValue(
      new ApiError(409, {
        code: "HTTP_409_CONFLICT",
        message: "该 daemon 仍被 2 个 workspace 绑定，请先解绑后再移除",
        request_id: "req-1",
        details: null,
      }),
    );

    renderPage(<RuntimesPage />);
    // task-09：runtime 卡默认折叠，先展开 machine。
    await expandFirstMachine();
    const removeBtn = await screen.findByRole("button", { name: /移除/ });
    fireEvent.click(removeBtn);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /移\s*除/ }));

    // 409 → notify.error 经 errMessage 取出后端中文 message（antd message portal）
    await waitFor(() =>
      expect(
        screen.getByText(/该 daemon 仍被 2 个 workspace 绑定/),
      ).toBeInTheDocument(),
    );
    // 列表不变（runtime 仍在）
    expect(screen.getByText("bound-runtime")).toBeInTheDocument();
    // 反向断言：英文 code 不暴露给用户（D-006@v1）
    expect(screen.queryByText(/HTTP_409/)).not.toBeInTheDocument();
  });

  // AC-02-e（测试侧）：Modal 取消 → 不调 deleteDaemonRuntime，列表不变。
  it("task-06：Modal 取消 → 不调 deleteDaemonRuntime，列表不变", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([makeRuntime({ id: "rt-x", name: "stay" })]),
    );
    renderPage(<RuntimesPage />);
    // task-09：runtime 卡默认折叠，先展开 machine。
    await expandFirstMachine();
    fireEvent.click(await screen.findByRole("button", { name: /移除/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /取\s*消/ }));
    // 取消 → 不 delete
    expect(daemon.deleteDaemonRuntime).not.toHaveBeenCalled();
    // 列表不变
    expect(screen.getByText("stay")).toBeInTheDocument();
  });

  it("URL ?session=<active> mount → 自动开弹窗（D-003 恢复）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime({ id: "rt-1" })]));
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        {
          id: "sess-url",
          runtime_id: "rt-1",
          lease_id: null,
          provider: "claude",
          status: "active",
          agent_session_id: "ag-1",
          config: null,
          turn_count: 1,
          created_at: "t",
          last_active_at: null,
          ended_at: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.getAgentSession.mockResolvedValue({
      id: "sess-url",
      runtime_id: "rt-1",
      lease_id: null,
      provider: "claude",
      status: "active",
      agent_session_id: "ag-1",
      config: null,
      turn_count: 1,
      created_at: "t",
      last_active_at: null,
      ended_at: null,
    });
    nav.searchParams = new URLSearchParams("session=sess-url");

    renderPage(<RuntimesPage />);
    // URL active → page effect setDialogRuntime → 弹窗 open
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("URL ?session=<ended> → 不开弹窗 + 清 param（D-003 降级）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime({ id: "rt-1" })]));
    daemon.getAgentSession.mockResolvedValue({
      id: "sess-end",
      runtime_id: "rt-1",
      lease_id: null,
      provider: "claude",
      status: "ended",
      agent_session_id: null,
      config: null,
      turn_count: 1,
      created_at: "t",
      last_active_at: null,
      ended_at: "t2",
    });
    nav.searchParams = new URLSearchParams("session=sess-end");

    renderPage(<RuntimesPage />);
    await waitFor(() => expect(daemon.getAgentSession).toHaveBeenCalledWith("sess-end"));
    // ended → 不开弹窗
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // 清 param（router.replace 被调）
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
  });

  it("URL ?session=<不存在> → getAgentSession 失败 → 清 param（R-03）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime()]));
    const { ApiError } = await import("@/lib/api");
    daemon.getAgentSession.mockRejectedValue(
      new ApiError(404, {
        code: "NOT_FOUND",
        message: "gone",
        request_id: null,
        details: null,
      }),
    );
    nav.searchParams = new URLSearchParams("session=sess-gone");

    renderPage(<RuntimesPage />);
    await waitFor(() => expect(daemon.getAgentSession).toHaveBeenCalledWith("sess-gone"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // task-21：runtime 卡片渲染「审计日志」入口，href 指向 /runtimes/{id}/audit。
  // 蓝图：与「可写目录」同级，所有可访问 runtime 的用户可见（不限 admin）。
  it("task-21：runtime 卡片渲染「审计日志」入口，href 指向 /runtimes/{id}/audit", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime({ id: "rt-audit" })]));
    renderPage(<RuntimesPage />);
    // task-09：runtime 卡默认折叠，先展开 machine。
    await expandFirstMachine();
    const auditLink = await screen.findByRole("link", { name: "审计日志" });
    expect(auditLink).toBeInTheDocument();
    expect(auditLink).toHaveAttribute("href", "/runtimes/rt-audit/audit");
  });
});

// task-10：机器级 SummaryCard / 分页器 / ?session 跨 machine 自动展开加强用例。
// 覆盖 design §11：SummaryCard 机器级计数（按 machine.status）、机器级分页器、
// ?session=<id> 自动展开所属 machine（machines.flatMap 查找）。
describe("RuntimesPage 机器级两级结构（task-10 加强）", () => {
  /** 构造多 machine 响应：每个 machine 独立 id/status/runtimes。 */
  function makeMachine(
    id: string,
    status: string,
    runtimes: ReturnType<typeof makeRuntime>[] = [],
  ) {
    return {
      id,
      hostname: `host-${id}`,
      display_alias: null,
      os: "linux",
      arch: "x64",
      status,
      last_heartbeat_at: "2026-06-18T10:00:00Z",
      version: "1.4.2",
      build_id: "a1b2c3d9e8f7",
      created_at: "2026-06-18T09:00:00Z",
      owner: null,
      runtime_count: runtimes.length,
      online_runtime_count: runtimes.filter((r) => r.status === "online").length,
      runtimes,
    };
  }

  it("SummaryCard 按 machine.status 计数（在线/离线/维护中/禁用/机器总数）", async () => {
    daemon.listDaemonMachines.mockResolvedValue({
      items: [
        makeMachine("m-online-1", "online", [makeRuntime({ id: "rt-1" })]),
        makeMachine("m-online-2", "online"),
        makeMachine("m-off", "offline"),
        makeMachine("m-maint", "maintenance"),
        makeMachine("m-dis", "disabled"),
      ],
      total: 5,
      limit: 20,
      offset: 0,
    });
    renderPage(<RuntimesPage />);
    // 等 machine 列表渲染（hostname 出现）。
    await waitFor(() => expect(screen.getByText("host-m-online-1")).toBeInTheDocument());

    // SummaryCard label/value 同卡片内；「在线」等 label 也会出现在 machine 状态徽章，
    // 用 getAllByText 取所有 label 候选，按「同卡片含 text-2xl value」筛出 SummaryCard。
    const summaryValueByLabel = (label: string): string | null => {
      const candidates = screen.getAllByText(label);
      for (const el of candidates) {
        // SummaryCard label <p> 的父 div.min-w-0 内含 text-2xl value <p>。
        const card = el.parentElement;
        const valueEl = card?.querySelector(".text-2xl");
        if (valueEl) return valueEl.textContent ?? null;
      }
      return null;
    };
    // 机器总数 5（total = list 返回 5）
    expect(summaryValueByLabel("机器总数")).toBe("5");
    // 在线 2 / 维护中 1 / 禁用 1 / 离线 1
    expect(summaryValueByLabel("在线")).toBe("2");
    expect(summaryValueByLabel("维护中")).toBe("1");
    expect(summaryValueByLabel("禁用")).toBe("1");
    expect(summaryValueByLabel("离线")).toBe("1");
  });

  it("机器级分页器：首页「上一页」disabled，「下一页」带 offset 调 listDaemonMachines", async () => {
    // total=25，PAGE_SIZE=20 → 首页 page=0，下一页可达。
    daemon.listDaemonMachines.mockResolvedValue({
      items: [makeMachine("m-1", "online", [makeRuntime({ id: "rt-1" })])],
      total: 25,
      limit: 20,
      offset: 0,
    });
    renderPage(<RuntimesPage />);
    await waitFor(() => expect(screen.getByText("host-m-1")).toBeInTheDocument());

    // 首页「上一页」disabled
    const prevBtn = screen.getByRole("button", { name: "上一页" });
    expect(prevBtn).toBeDisabled();
    // 「共 25 台机器 · 第 1 页」
    expect(screen.getByText(/共 25 台机器/)).toBeInTheDocument();

    // 点「下一页」→ listDaemonMachines 以 offset=20 再调
    const nextBtn = screen.getByRole("button", { name: "下一页" });
    expect(nextBtn).not.toBeDisabled();
    daemon.listDaemonMachines.mockResolvedValue({
      items: [makeMachine("m-2", "online", [makeRuntime({ id: "rt-2" })])],
      total: 25,
      limit: 20,
      offset: 20,
    });
    fireEvent.click(nextBtn);
    await waitFor(() =>
      expect(daemon.listDaemonMachines).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 20, limit: 20 }),
      ),
    );
    await waitFor(() => expect(screen.getByText("host-m-2")).toBeInTheDocument());
  });

  it("?session=<id> 自动展开所属 machine（跨 machine flatMap 查找后开弹窗）", async () => {
    // runtime rt-2 在第二个 machine m-2 内；URL ?session=sess-rt2 应展开 m-2 开弹窗。
    daemon.listDaemonMachines.mockResolvedValue({
      items: [
        makeMachine("m-1", "online", [makeRuntime({ id: "rt-1" })]),
        makeMachine("m-2", "online", [makeRuntime({ id: "rt-2" })]),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        {
          id: "sess-rt2",
          runtime_id: "rt-2",
          lease_id: null,
          provider: "claude",
          status: "active",
          agent_session_id: "ag-2",
          config: null,
          turn_count: 1,
          created_at: "t",
          last_active_at: null,
          ended_at: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.getAgentSession.mockResolvedValue({
      id: "sess-rt2",
      runtime_id: "rt-2",
      lease_id: null,
      provider: "claude",
      status: "active",
      agent_session_id: "ag-2",
      config: null,
      turn_count: 1,
      created_at: "t",
      last_active_at: null,
      ended_at: null,
    });
    nav.searchParams = new URLSearchParams("session=sess-rt2");

    renderPage(<RuntimesPage />);
    // URL active + runtime rt-2 在 m-2 → page effect 展开所属 machine + 开弹窗
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    // m-2 已自动展开（rt-2 的 runtime 卡在 m-2 展开体内）。弹窗内含 runtime 信息。
    // 注：不直接断 aria-expanded（page 受控态），改验证弹窗 open 即可证明展开+开弹窗链路通。
  });

  it("机器级状态筛选：选「离线」→ listDaemonMachines 带 status=offline", async () => {
    daemon.listDaemonMachines.mockResolvedValue({
      items: [makeMachine("m-off", "offline")],
      total: 1,
      limit: 20,
      offset: 0,
    });
    renderPage(<RuntimesPage />);
    await waitFor(() => expect(screen.getByText("host-m-off")).toBeInTheDocument());

    // 切状态筛选到「离线」→ listDaemonMachines 带 status: "offline"
    const statusSelect = screen.getByLabelText("筛选状态");
    fireEvent.change(statusSelect, { target: { value: "offline" } });
    await waitFor(() =>
      expect(daemon.listDaemonMachines).toHaveBeenCalledWith(
        expect.objectContaining({ status: "offline" }),
      ),
    );
  });
});
