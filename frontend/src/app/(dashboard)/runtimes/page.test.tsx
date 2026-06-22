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

// ── next/navigation mock（ql-20260623 改动一：page 现使用 useSearchParams/useRouter） ──

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
    deleteDaemonRuntime: daemon.deleteDaemonRuntime,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    getAgentSession: daemon.getAgentSession,
    reopenSession: daemon.reopenSession,
    streamSession: daemon.streamSession,
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
  // ql-20260623：重置 next/navigation mock 状态
  nav.searchParams = new URLSearchParams();
  nav.replace = vi.fn();
  daemon.listDaemonRuntimes.mockResolvedValue([]);
  daemon.listAgentSessions.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  daemon.deleteAgentSession.mockResolvedValue(undefined);
  daemon.deleteDaemonRuntime.mockResolvedValue(undefined);
  daemon.getAgentSessionLogs.mockResolvedValue([]);
  daemon.reopenSession.mockResolvedValue({ session_id: "stub", status: "reconnecting" });
  daemon.getAgentSession.mockResolvedValue({
    id: "stub", runtime_id: null, lease_id: null, provider: "claude",
    status: "reconnecting", agent_session_id: "ag", config: null,
    turn_count: 0, created_at: "t", last_active_at: null, ended_at: null,
  });
  // task-11 attach panel：streamSession 返回 no-op 连接（避免 EventSource 网络请求）
  daemon.streamSession.mockImplementation(() => ({
    close: () => {},
    getLastEventId: () => null,
  }));
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

  it("ql-012 removes a runtime via card 移除 button after confirm", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      {
        id: "rt-del",
        name: "daemon-to-remove",
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
    const removeBtn = await screen.findByRole("button", { name: /移除/ });
    fireEvent.click(removeBtn);

    await waitFor(() => expect(daemon.deleteDaemonRuntime).toHaveBeenCalledWith("rt-del"));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText("daemon-to-remove")).not.toBeInTheDocument(),
    );
  });

  it("ql-012 card 会话 button focuses the runtime in the session section", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      {
        id: "rt-focus",
        name: "MyClaude",
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
    const sessionBtn = await screen.findByRole("button", { name: /^会话$/ });
    fireEvent.click(sessionBtn);

    // 聚焦态：会话标题含 runtime 名 + 「显示全部」退出按钮可见
    await waitFor(() => expect(screen.getByText(/会话 · MyClaude/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "显示全部" })).toBeInTheDocument();
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

  it("renders delete button for active session and deletes it (task-04)", async () => {
    // task-04：去掉 {!active} 限制，active 会话也渲染删除按钮；点击 → confirm → deleteAgentSession
    const sid = "sess-active2";
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
    daemon.getAgentSessionLogs.mockResolvedValue([]);

    render(<RuntimesPage />);
    const deleteButton = await screen.findByRole("button", {
      name: `删除会话 ${sid}`,
    });
    expect(deleteButton).toBeInTheDocument();

    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(daemon.deleteAgentSession).toHaveBeenCalledWith(sid),
    );
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(/sess-active2/)).not.toBeInTheDocument(),
    );
  });

  it("renders user-channel log as right-aligned primary bubble and others as left (task-02)", async () => {
    const sid = "sess-mixed1";
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
          turn_count: 1,
          created_at: "2026-06-19T09:00:00Z",
          last_active_at: "2026-06-19T09:30:00Z",
          ended_at: "2026-06-19T09:30:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.getAgentSessionLogs.mockResolvedValue([
      {
        id: "lu",
        run_id: "run-a",
        timestamp: "2026-06-19T09:10:00Z",
        channel: "user_input",
        content_redacted: "user prompt here",
      },
      {
        id: "ls",
        run_id: "run-a",
        timestamp: "2026-06-19T09:10:05Z",
        channel: "stdout",
        content_redacted: "agent reply here",
      },
    ]);

    render(<RuntimesPage />);
    fireEvent.click(await screen.findByText(/sess-mixed1/));

    const userBubble = await screen.findByText("user prompt here");
    const agentBubble = await screen.findByText("agent reply here");
    // user → primary 右对齐气泡（内层 max-w div 是文本父级，外层 flex 控制对齐）
    expect(userBubble.closest("div.bg-primary")).not.toBeNull();
    expect(userBubble.parentElement).toHaveClass("justify-end");
    expect(userBubble).toHaveClass("text-primary-foreground");
    // agent → 左对齐白底气泡（border bg-card，非 primary）
    expect(agentBubble.closest("div.bg-primary")).toBeNull();
    expect(agentBubble.parentElement).toHaveClass("justify-start");
    expect(agentBubble).toHaveClass("bg-card");
  });

  it("renders agent-only history without user log without crashing (task-02 D-005)", async () => {
    const sid = "sess-agent1";
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
          turn_count: 1,
          created_at: "2026-06-19T09:00:00Z",
          last_active_at: "2026-06-19T09:30:00Z",
          ended_at: "2026-06-19T09:30:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.getAgentSessionLogs.mockResolvedValue([
      {
        id: "lo",
        run_id: "run-old",
        timestamp: "2026-06-19T09:10:00Z",
        channel: "stdout",
        content_redacted: "legacy agent only",
      },
    ]);

    render(<RuntimesPage />);
    fireEvent.click(await screen.findByText(/sess-agent1/));

    const bubble = await screen.findByText("legacy agent only");
    // 旧会话无 user log：仅左对齐白底气泡，不报错
    expect(bubble.closest("div.bg-primary")).toBeNull();
    expect(bubble.parentElement).toHaveClass("justify-start");
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

  /* ---------- task-11：续聊按钮 + attach 切换 ---------- */

  async function renderWithSession(session: Record<string, unknown>) {
    daemon.listAgentSessions.mockResolvedValue({
      items: [session],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const utils = render(<RuntimesPage />);
    return utils;
  }

  function claudeEndedSession(overrides: Record<string, unknown> = {}) {
    return {
      id: "sess-resume1",
      runtime_id: "r1",
      lease_id: null,
      provider: "claude",
      status: "ended",
      agent_session_id: "ag-123",
      config: null,
      turn_count: 3,
      created_at: "2026-06-19T09:00:00Z",
      last_active_at: "2026-06-19T09:30:00Z",
      ended_at: "2026-06-19T09:30:00Z",
      ...overrides,
    };
  }

  it("AC-11-01 ended claude 会话（有 agent_session_id）回看显示可点「继续对话」按钮", async () => {
    await renderWithSession(claudeEndedSession());
    // 点选会话进历史回看
    fireEvent.click(await screen.findByText(/sess-resume1/));
    const btn = await screen.findByRole("button", { name: /继续对话/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("AC-11-02 codex 会话回看：续聊按钮置灰 + title 提示", async () => {
    await renderWithSession(claudeEndedSession({ provider: "codex" }));
    fireEvent.click(await screen.findByText(/sess-resume1/));
    const btn = await screen.findByRole("button", { name: /继续对话/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/codex 暂不支持续聊/);
  });

  it("AC-11-03 无 agent_session_id failed：按钮置灰 + title 提示", async () => {
    await renderWithSession(
      claudeEndedSession({ status: "failed", agent_session_id: null }),
    );
    fireEvent.click(await screen.findByText(/sess-resume1/));
    const btn = await screen.findByRole("button", { name: /继续对话/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/会话未建立/);
  });

  it("AC-11-04 active 会话回看：不显示续聊按钮", async () => {
    await renderWithSession(
      claudeEndedSession({ status: "active", ended_at: null }),
    );
    fireEvent.click(await screen.findByText(/sess-resume1/));
    // 等待历史视图渲染（logs 加载）
    await waitFor(() => expect(daemon.getAgentSessionLogs).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /继续对话/ })).not.toBeInTheDocument();
  });

  it("AC-11-05 点击续聊：reopenSession → 右侧切 attach panel（建 SSE + 预填历史 turn）", async () => {
    daemon.getAgentSessionLogs.mockResolvedValue([
      {
        id: "lu1", run_id: "run-x", timestamp: "t1",
        channel: "user_input", content_redacted: "历史用户提问",
      },
      {
        id: "ls1", run_id: "run-x", timestamp: "t2",
        channel: "stdout", content_redacted: "历史 agent 回答",
      },
    ]);
    await renderWithSession(claudeEndedSession());
    fireEvent.click(await screen.findByText(/sess-resume1/));
    // 等历史加载
    await waitFor(() => expect(screen.getByText(/历史用户提问/)).toBeInTheDocument());

    fireEvent.click(await screen.findByRole("button", { name: /继续对话/ }));

    await waitFor(() =>
      expect(daemon.reopenSession).toHaveBeenCalledWith("sess-resume1"),
    );
    // 右侧切 attach panel：InteractiveSessionPanel header 「交互式会话」可见
    await waitFor(() =>
      expect(screen.getByText(/交互式会话/)).toBeInTheDocument(),
    );
    // attach panel 建立 SSE（streamSession 以 sess-resume1 调用）
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "sess-resume1",
        expect.anything(),
      ),
    );
  });

  it("AC-11-06 reopen 失败：setListError 提示，不切 attach", async () => {
    const { ApiError } = await import("@/lib/api");
    daemon.reopenSession.mockRejectedValue(
      new ApiError(409, {
        code: "DAEMON_SESSION_OFFLINE",
        message: "daemon offline",
        request_id: null,
        details: null,
      }),
    );
    await renderWithSession(claudeEndedSession());
    fireEvent.click(await screen.findByText(/sess-resume1/));
    fireEvent.click(await screen.findByRole("button", { name: /继续对话/ }));

    await waitFor(() =>
      expect(daemon.reopenSession).toHaveBeenCalledWith("sess-resume1"),
    );
    // 错误提示出现
    await waitFor(() => expect(screen.getByText(/daemon offline/)).toBeInTheDocument());
    // 仍在历史回看（未切 attach）
    expect(screen.getByText(/历史回看/)).toBeInTheDocument();
    expect(daemon.streamSession).not.toHaveBeenCalled();
  });

  /* ---------- ql-20260623 改动一：URL ?session= 恢复 ---------- */

  it("改动一-4：URL ?session=<active> mount 时自动 attach（建 SSE）", async () => {
    const sid = "sess-url-active";
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        {
          id: sid, runtime_id: "r1", lease_id: null, provider: "claude",
          status: "active", agent_session_id: "ag-1", config: null,
          turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
        },
      ],
      total: 1, limit: 50, offset: 0,
    });
    nav.searchParams = new URLSearchParams("session=sess-url-active");

    render(<RuntimesPage />);
    // URL 里的 active 会话 → 自动进入 attach 链路（建 SSE）
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "sess-url-active",
        expect.anything(),
      ),
    );
    // 「交互式会话」面板 header 可见（attach panel 渲染）
    await waitFor(() =>
      expect(screen.getByText(/交互式会话/)).toBeInTheDocument(),
    );
  });

  it("改动一-6：URL ?session=<ended> → 降级 idle + 清 param（不卡死）", async () => {
    const sid = "sess-url-ended";
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        {
          id: sid, runtime_id: "r1", lease_id: null, provider: "claude",
          status: "ended", agent_session_id: null, config: null,
          turn_count: 1, created_at: "t", last_active_at: null, ended_at: "t2",
        },
      ],
      total: 1, limit: 50, offset: 0,
    });
    nav.searchParams = new URLSearchParams("session=sess-url-ended");

    render(<RuntimesPage />);
    // ended → 不 attach（不建 SSE），降级回 idle（live panel）
    await waitFor(() => expect(screen.getByText(/交互式会话/)).toBeInTheDocument());
    expect(daemon.streamSession).not.toHaveBeenCalled();
    // 清 param（router.replace 被调用）
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
  });

  it("改动一-6：URL ?session=<不存在/已删> → getAgentSession 兜底失败 → 清 param", async () => {
    daemon.listAgentSessions.mockResolvedValue({
      items: [], total: 0, limit: 50, offset: 0,
    });
    const { ApiError } = await import("@/lib/api");
    daemon.getAgentSession.mockRejectedValue(
      new ApiError(404, {
        code: "NOT_FOUND", message: "gone", request_id: null, details: null,
      }),
    );
    nav.searchParams = new URLSearchParams("session=sess-gone");

    render(<RuntimesPage />);
    // getAgentSession 兜底查 → 404 → 降级 idle + 清 param
    await waitFor(() => expect(daemon.getAgentSession).toHaveBeenCalledWith("sess-gone"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(daemon.streamSession).not.toHaveBeenCalled();
  });
});
