/**
 * task-12：runtimes/page.tsx 会话列表 + 历史回看 + permission 审批弹窗集成测试。
 *
 * mock lib/daemon 的会话查询 / 历史 / permission respond，以及 EventSource。
 * task-11 的 InteractiveSessionPanel 行为由其自身测试覆盖；本文件只验证
 * task-12 新增的列表 / 历史切换 / 审批弹窗挂载，且不回归 runtime 列表渲染。
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RuntimesPage from "@/app/(dashboard)/runtimes/page";
import { useSession } from "@/stores/session";

// ── mocks ────────────────────────────────────────────────────────────────────

const daemon = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  respondSessionPermission: vi.fn(),
  parseSessionPermissionEvent: vi.fn(() => null),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemon.listDaemonRuntimes,
    listAgentSessions: daemon.listAgentSessions,
    deleteAgentSession: daemon.deleteAgentSession,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    respondSessionPermission: daemon.respondSessionPermission,
    parseSessionPermissionEvent: daemon.parseSessionPermissionEvent,
  };
});

// EventSource stub (task-06 SSE / task-08 permission SSE 不在此直接测)
class FakeES {
  static instances: FakeES[] = [];
  url: string;
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeES.instances.push(this);
  }
  addEventListener(kind: string, cb: (e: { data: string }) => void) {
    (this.listeners[kind] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {}
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  vi.stubGlobal("EventSource", FakeES);
  FakeES.instances.length = 0;
  daemon.listDaemonRuntimes.mockResolvedValue([]);
  daemon.listAgentSessions.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  daemon.deleteAgentSession.mockResolvedValue(undefined);
  daemon.getAgentSessionLogs.mockResolvedValue([]);
  daemon.respondSessionPermission.mockResolvedValue({ accepted: true });
  daemon.parseSessionPermissionEvent.mockReturnValue(null);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RuntimesPage session list + history", () => {
  it("renders runtime list (task-11 regression) and empty session list", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      {
        id: "rt-1",
        name: "daemon",
        provider: "claude",
        version: "1.0.0",
        status: "online",
        last_heartbeat_at: "2026-06-18T10:00:00Z",
        capabilities: { protocol: "ws", agents: ["claude"] },
        created_at: "2026-06-18T09:00:00Z",
        updated_at: "2026-06-18T10:00:00Z",
      },
    ]);
    render(<RuntimesPage />);
    await waitFor(() => expect(screen.getByText("daemon")).toBeInTheDocument());
    // session list empty state visible
    await waitFor(() => expect(screen.getByText(/没有会话/)).toBeInTheDocument());
    expect(screen.getByTestId("runtime-list-scroll")).toHaveClass("max-h-[680px]");
    expect(screen.getByTestId("session-list-scroll")).toHaveClass("max-h-[520px]");
  });

  it("loads session list and selects a history (ended) session into read-only view", async () => {
    const sid = "sess-ended-1";
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        {
          id: sid,
          runtime_id: "r1",
          lease_id: null,
          provider: "claude",
          status: "ended",
          agent_session_id: null,
          config: null,
          turn_count: 2,
          created_at: "2026-06-18T09:00:00Z",
          last_active_at: "2026-06-18T09:30:00Z",
          ended_at: "2026-06-18T09:30:00Z",
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    daemon.getAgentSessionLogs.mockResolvedValue([
      {
        id: "l1",
        run_id: "run-a",
        timestamp: "2026-06-18T09:10:00Z",
        channel: "stdout",
        content_redacted: "turn1 output",
      },
      {
        id: "l2",
        run_id: "run-b",
        timestamp: "2026-06-18T09:20:00Z",
        channel: "stdout",
        content_redacted: "turn2 output",
      },
    ]);

    render(<RuntimesPage />);
    const item = await screen.findByText(/sess-ended/);
    fireEvent.click(item);

    // history view renders logs grouped by run
    await waitFor(() => {
      expect(screen.getByText("turn1 output")).toBeInTheDocument();
      expect(screen.getByText("turn2 output")).toBeInTheDocument();
    });
    // read-only: no send / interrupt / end for history
    expect(screen.queryByTitle(/发送/)).not.toBeInTheDocument();
  });

  it("does not render the permission dialog when queue is empty", async () => {
    render(<RuntimesPage />);
    await waitFor(() => expect(daemon.listAgentSessions).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms and deletes a terminal session from the list", async () => {
    const session = {
      id: "sess-ended-1",
      runtime_id: "r1",
      lease_id: null,
      provider: "claude",
      status: "ended" as const,
      agent_session_id: null,
      config: null,
      turn_count: 2,
      created_at: "2026-06-18T09:00:00Z",
      last_active_at: "2026-06-18T09:30:00Z",
      ended_at: "2026-06-18T09:30:00Z",
    };
    daemon.listAgentSessions.mockResolvedValue({
      items: [session],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<RuntimesPage />);
    const deleteButton = await screen.findByRole("button", {
      name: "删除会话 sess-ended-1",
    });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(daemon.deleteAgentSession).toHaveBeenCalledWith(session.id));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/sess-ended/)).not.toBeInTheDocument());
  });

  it("loads an active session into read-only history view (ql-20260619-007)", async () => {
    // ql-007 回归：active 会话选中后不再走 live 空白分支，统一只读回看历史日志。
    // sid 取 12 字符以内避免 shortId() 截断（>12 会变成「前8…后4」）。
    const sid = "sess-active1";
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        {
          id: sid,
          runtime_id: "r1",
          lease_id: null,
          provider: "claude",
          status: "active",
          agent_session_id: null,
          config: null,
          turn_count: 1,
          created_at: "2026-06-19T09:00:00Z",
          last_active_at: "2026-06-19T09:30:00Z",
          ended_at: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.getAgentSessionLogs.mockResolvedValue([
      {
        id: "l1",
        run_id: "run-x",
        timestamp: "2026-06-19T09:10:00Z",
        channel: "stdout",
        content_redacted: "active session history output",
      },
    ]);

    render(<RuntimesPage />);
    const item = await screen.findByText(/sess-active1/);
    fireEvent.click(item);

    // active 会话也调 getAgentSessionLogs 并渲染历史日志（不再空白 live 分支）
    await waitFor(() =>
      expect(daemon.getAgentSessionLogs).toHaveBeenCalledWith(sid),
    );
    await waitFor(() =>
      expect(screen.getByText("active session history output")).toBeInTheDocument(),
    );
    // 只读视图：无 live 面板的发送控件
    expect(screen.queryByTitle(/发送/)).not.toBeInTheDocument();
  });
});
