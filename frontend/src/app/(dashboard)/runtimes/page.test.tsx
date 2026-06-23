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

import RuntimesPage from "@/app/(dashboard)/runtimes/page";
import { useSession } from "@/stores/session";

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
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RuntimesPage（弹窗化后，task-04/05）", () => {
  it("渲染 runtime 列表，无底部常驻会话区（卡片去 max-h）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([makeRuntime()]);
    render(<RuntimesPage />);
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
    render(<RuntimesPage />);
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

  it("ql-012 移除 runtime（confirm → deleteDaemonRuntime）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({ id: "rt-del", name: "to-remove" }),
    ]);
    render(<RuntimesPage />);
    const removeBtn = await screen.findByRole("button", { name: /移除/ });
    fireEvent.click(removeBtn);
    await waitFor(() => expect(daemon.deleteDaemonRuntime).toHaveBeenCalledWith("rt-del"));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("to-remove")).not.toBeInTheDocument());
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

    render(<RuntimesPage />);
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

    render(<RuntimesPage />);
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

    render(<RuntimesPage />);
    await waitFor(() => expect(daemon.getAgentSession).toHaveBeenCalledWith("sess-gone"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
