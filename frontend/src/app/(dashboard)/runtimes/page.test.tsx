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

// ── mocks ────────────────────────────────────────────────────────────────────

const daemon = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  deleteDaemonRuntime: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  getAgentSession: vi.fn(),
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemon.listDaemonRuntimes,
    // task-07：page 列表数据源改 listDaemonRuntimesPage；测试 mock 仍按
    // listDaemonRuntimes 数组设置，这里包装成分页响应，无需改每个 mockResolvedValue。
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

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  vi.stubGlobal("EventSource", FakeES);
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
  // task-07：删除 vi.stubGlobal("confirm", ...) —— task-06 已改用 antd Modal.confirm，
  // 不再走 window.confirm。
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RuntimesPage（弹窗化后，task-04/05）", () => {
  it("渲染 runtime 列表，无底部常驻会话区（卡片去 max-h）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime()]);
    renderPage(<RuntimesPage />);
    await waitFor(() => expect(screen.getByText("daemon")).toBeInTheDocument());
    // runtime-list-scroll 仍在（卡片区），但 task-04 移除了 max-h-[680px]
    const list = screen.getByTestId("runtime-list-scroll");
    expect(list).not.toHaveClass("max-h-[680px]");
    // 无底部常驻会话区 empty state（"没有会话" 属弹窗内，弹窗未开不在页面层）
    expect(screen.queryByText(/没有会话/)).not.toBeInTheDocument();
    // 弹窗未开（无 dialog role）
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("点 runtime 卡片「会话」按钮 → 弹出 RuntimeSessionDialog（D-001 单例）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ name: "MyClaude" })]);
    renderPage(<RuntimesPage />);
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
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({ id: "rt-del", name: "to-remove" }),
    ]);
    renderPage(<RuntimesPage />);
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
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({ id: "rt-bound", name: "bound-runtime" }),
    ]);
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
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({ id: "rt-x", name: "stay" }),
    ]);
    renderPage(<RuntimesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /移除/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /取\s*消/ }));
    // 取消 → 不 delete
    expect(daemon.deleteDaemonRuntime).not.toHaveBeenCalled();
    // 列表不变
    expect(screen.getByText("stay")).toBeInTheDocument();
  });

  it("URL ?session=<active> mount → 自动开弹窗（D-003 恢复）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-1" })]);
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
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime({ id: "rt-1" })]);
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
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime()]);
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
});
