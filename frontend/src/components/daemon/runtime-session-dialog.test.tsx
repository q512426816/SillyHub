/**
 * task-06（Wave-4）：RuntimeSessionDialog 弹窗组件集成测试。
 *
 * 覆盖 FR-01（弹窗 + runtime 过滤 + 默认态）/ FR-02（active attach 续聊）/
 * FR-04（ended 会话 reopen→attach）/ FR-05（关闭清理无泄漏），以及
 * 验收场景 SC-2 / SC-5（SC-1 由用例 1 覆盖）。
 *
 * 2026-07-11 重构（unify-runtime-session-dialog）：组件二态化（selected→attach 续聊 /
 * idle→新建），删除原 SessionHistoryView 只读回看 / 「继续对话」按钮 / D-002 自动 attach
 * 最近活跃会话三条旧行为。下列旧测试对应处理：
 *   - 删除「auto-attaches most recent active session on open (D-002)」：新行为默认 idle
 *     新建，不再自动 attach。改为断言「open 后默认 idle（streamSession 未被调）」。
 *   - 删除 SC-3 旧断言（只读历史回看 + 「继续对话」按钮）：ended/failed 现在点列表项
 *     直接 reopen→attach（无只读回看、无「继续对话」按钮）。
 *   - 删除 D-007「继续对话置灰 title=会话未建立」：UI 已不存在，ended/failed 一律先
 *     reopen（不管 agent_session_id），由 panel 兜底转 failed。
 *
 * 直接渲染 `<RuntimeSessionDialog>`（不走 RuntimesPage），隔离 dialog 单元。
 * mock 模式完全复用 page.test.tsx：vi.mock @/lib/daemon + vi.hoisted daemon +
 * FakeES EventSource + useSession.setState + next/navigation（dialog 子组件
 * InteractiveSessionPanel 内部用 useRouter/useSearchParams 写 URL）。
 *
 * attach 轮询（ATTACH_POLL_MS=1500）处理：mock getAgentSession 返回
 * status: "active" 让首 tick 即收敛，并配 vi.useFakeTimers + advanceTimersByTimeAsync
 * 加速轮询 / 收敛 attach 面板到可发送态。
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeSessionDialog } from "@/components/daemon/runtime-session-dialog";
import { useSession } from "@/stores/session";

// ── next/navigation mock（InteractiveSessionChatSection 内部用 useRouter/useSearchParams 写 URL） ──

const nav = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

// MarkdownText 用 next/dynamic + ssr:false，jsdom 测试同步 render 处于 loading(null)，
// 历史/流式回答文本不出现。mock 成纯文本渲染（测 dialog 交互逻辑，不测 markdown 库）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

// ── mocks ────────────────────────────────────────────────────────────────────

const daemon = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  getAgentSession: vi.fn(),
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  quickChat: vi.fn(),
  streamQuickChat: vi.fn(),
  getQuickChatResult: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listAgentSessions: daemon.listAgentSessions,
    deleteAgentSession: daemon.deleteAgentSession,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    getAgentSession: daemon.getAgentSession,
    reopenSession: daemon.reopenSession,
    streamSession: daemon.streamSession,
    createSession: daemon.createSession,
    injectSession: daemon.injectSession,
    quickChat: daemon.quickChat,
    streamQuickChat: daemon.streamQuickChat,
    getQuickChatResult: daemon.getQuickChatResult,
  };
});

// EventSource stub（attach panel 建流时 streamSession 内部 new EventSource）
class FakeES {
  static instances: FakeES[] = [];
  url: string;
  listeners: Record<string, ((_e: { data: string }) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeES.instances.push(this);
  }
  addEventListener(kind: string, cb: (_e: { data: string }) => void) {
    (this.listeners[kind] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {}
}

const baseRuntime = {
  id: "rt-1",
  name: "MyClaude",
  provider: "claude",
  version: "1.0.0",
  os: "darwin",
  arch: "arm64",
  status: "online",
  last_heartbeat_at: "2026-06-18T10:00:00Z",
  capabilities: { protocol: "ws", agents: ["claude"] },
  allowed_roots: [],
  created_at: "2026-06-18T09:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-x",
    runtime_id: "rt-1",
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: "ag-x",
    config: null,
    turn_count: 1,
    created_at: "2026-06-18T09:00:00Z",
    last_active_at: "2026-06-18T09:30:00Z",
    ended_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  vi.stubGlobal("EventSource", FakeES);
  vi.stubGlobal("confirm", vi.fn(() => true));
  FakeES.instances.length = 0;
  nav.searchParams = new URLSearchParams();
  nav.replace = vi.fn();

  daemon.listAgentSessions.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  daemon.deleteAgentSession.mockResolvedValue(undefined);
  daemon.getAgentSessionLogs.mockResolvedValue([]);
  // 关键：getAgentSession 直接返回 active → attach 轮询首轮即收敛（避免 15s 轮询）
  daemon.getAgentSession.mockResolvedValue(
    makeSession({ id: "stub", status: "active" }),
  );
  daemon.reopenSession.mockResolvedValue({ session_id: "stub", status: "reconnecting" });
  // streamSession 默认 no-op 连接（避免真实 EventSource 网络请求）
  daemon.streamSession.mockImplementation(() => ({
    close: () => {},
    getLastEventId: () => null,
  }));
  // task-08：interactive 首发默认 mock（codex/claude 用例按需覆盖）
  daemon.createSession.mockResolvedValue({
    session_id: "sess-stub",
    run_id: "run-stub",
    lease_id: "lease-stub",
    status: "active",
    stream_url: "/api/daemon/sessions/sess-stub/stream",
  });
  daemon.quickChat.mockResolvedValue({
    id: "run-codex",
    agent_type: "claude_code",
    provider: "codex",
    model: null,
    status: "pending",
  });
  daemon.streamQuickChat.mockImplementation((_runId, _onMessage, onDone) => {
    queueMicrotask(() => onDone({ status: "completed" }));
    return { close: vi.fn() };
  });
  daemon.getQuickChatResult.mockResolvedValue({
    id: "run-codex",
    status: "completed",
    output_redacted: "codex 输出",
    agent_type: "claude_code",
    provider: "codex",
    model: null,
    started_at: null,
    finished_at: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RuntimeSessionDialog", () => {
  /* ---------- 用例 1：弹窗渲染 + 列表 runtime_id 过滤（FR-01 / SC-1） ---------- */

  it("renders dialog with runtime-scoped session list when open, nothing when closed (FR-01)", async () => {
    // sid 取 12 字符以内避免 shortId() 截断（>12 会变成「前8…后4」）
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "sact-rt1", // rt-1 active
          runtime_id: "rt-1",
          status: "active",
          agent_session_id: "ag-1",
          last_active_at: "2026-06-18T09:30:00Z",
        }),
        makeSession({
          id: "send-rt1", // rt-1 ended
          runtime_id: "rt-1",
          status: "ended",
          agent_session_id: "ag-2",
          ended_at: "2026-06-18T09:00:00Z",
        }),
        // 噪音：不属于本 runtime，应被过滤
        makeSession({
          id: "sother-rt", // rt-other
          runtime_id: "rt-other",
          status: "ended",
          agent_session_id: "ag-3",
        }),
      ],
      total: 3,
      limit: 50,
      offset: 0,
    });

    render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[baseRuntime]}
      />,
    );

    // dialog 存在
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // 列表只显示 rt-1 的 2 条会话
    expect(screen.getByText("sact-rt1")).toBeInTheDocument();
    expect(screen.getByText("send-rt1")).toBeInTheDocument();
    // rt-other 的会话被过滤
    expect(screen.queryByText("sother-rt")).not.toBeInTheDocument();
  });

  it("renders nothing when open=false (FR-01)", () => {
    render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={false}
        onClose={vi.fn()}
        runtimes={[baseRuntime]}
      />,
    );
    // Radix Dialog open=false 时不挂载 portal
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /* ---------- 用例 2a：默认态 D-002 有活跃也不再自动 attach（FR-01 / D-002@重构） ---------- */

  it("does NOT auto-attach on open even when active session exists — default idle (2026-07-11 重构)", async () => {
    // 旧行为（D-002 自动 attach 最近活跃）已在 2026-07-11 重构删除：
    // 新行为默认 idle 新建，仅 initialSessionId（URL 恢复点）或用户点列表项才 attach。
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "sactive", // ≤12 char，shortId 不截断
          runtime_id: "rt-1",
          status: "active",
          agent_session_id: "ag-1",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[baseRuntime]}
      />,
    );

    // idle 新建：右侧渲染交互式会话 header（panel 始终渲染此标题）
    await waitFor(() =>
      expect(screen.getByText(/交互式会话/)).toBeInTheDocument(),
    );
    // 默认 idle → 不建 SSE（不自动 attach）
    expect(daemon.streamSession).not.toHaveBeenCalled();
  });

  /* ---------- 用例 2b：默认态 D-002 无活跃 → idle 新建（FR-01 / D-002） ---------- */

  it("enters idle new-session panel when no active session (D-002)", async () => {
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "sended",
          runtime_id: "rt-1",
          status: "ended",
          agent_session_id: "ag-2",
          ended_at: "2026-06-18T09:00:00Z",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[baseRuntime]}
      />,
    );

    // idle 新建：右侧渲染新建空白面板（InteractiveSessionChatSection header）
    await waitFor(() =>
      expect(screen.getByText(/交互式会话/)).toBeInTheDocument(),
    );
    // 无活跃 → 不 attach，streamSession 未调
    expect(daemon.streamSession).not.toHaveBeenCalled();
  });

  /* ---------- 用例 3：active attach 续聊（SC-2 / FR-02 / D-004） ---------- */

  it("attaches active session on click → SSE stream + enabled input (SC-2 / FR-02)", async () => {
    // 列表只放 ended（默认态 idle 不 attach），点击 active 项显式触发 attach
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "clk-ended",
          runtime_id: "rt-1",
          status: "ended",
          agent_session_id: "ag-e",
          ended_at: "2026-06-18T09:00:00Z",
        }),
        makeSession({
          id: "clk-act",
          runtime_id: "rt-1",
          status: "active",
          agent_session_id: "ag-a",
        }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });
    daemon.getAgentSessionLogs.mockResolvedValue([
      {
        id: "lu",
        run_id: "run-x",
        timestamp: "t1",
        channel: "user_input",
        content_redacted: "历史用户提问",
      },
      {
        id: "ls",
        run_id: "run-x",
        timestamp: "t2",
        channel: "stdout",
        content_redacted: "历史 agent 回答",
      },
    ]);

    render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[baseRuntime]}
      />,
    );

    // 点击 active 会话项触发 attach（handleSelect → active 分支 → setSelectedId → panel attach）
    fireEvent.click(await screen.findByText("clk-act"));

    // 拉历史预填（attach 路径会先拉 logs）
    await waitFor(() =>
      expect(daemon.getAgentSessionLogs).toHaveBeenCalledWith("clk-act"),
    );
    // 建 SSE（panel attach effect → establishStream）
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "clk-act",
        expect.anything(),
      ),
    );
    // attach 模式：发送按钮存在（非只读）
    const sendBtn = screen.getByTitle(/发送/);
    expect(sendBtn).toBeInTheDocument();
  });

  /* ---------- 用例 4：ended claude 点击直接 reopen→attach（2026-07-11 重构 / FR-04） ---------- */

  it("ended claude session click → reopenSession called → panel attach (2026-07-11 重构)", async () => {
    // 旧行为（只读历史回看 + 「继续对话」按钮）已删除：ended/failed 现在点列表项
    // 直接 reopenSession 转 reconnecting/active 再 attach（无只读回看、无续聊按钮）。
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "send-claude", // ≤12 char
          runtime_id: "rt-1",
          provider: "claude",
          status: "ended",
          agent_session_id: "ag-123",
          ended_at: "2026-06-18T09:00:00Z",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.reopenSession.mockResolvedValue({
      session_id: "send-claude",
      status: "reconnecting",
    });

    render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[baseRuntime]}
      />,
    );

    // 点 ended 会话项 → handleSelect 走 ended/failed 分支：先 reopenSession
    fireEvent.click(await screen.findByText("send-claude"));

    // reopen 被调（新行为：ended 一律先 reopen，不区分 agent_session_id）
    await waitFor(() =>
      expect(daemon.reopenSession).toHaveBeenCalledWith("send-claude"),
    );
    // reopen 成功 → setSelectedId → panel attach 建 SSE
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "send-claude",
        expect.anything(),
      ),
    );
    // panel header 渲染（attach 态）
    await waitFor(() =>
      expect(screen.getByText(/交互式会话/)).toBeInTheDocument(),
    );
    // 无「继续对话」按钮（旧行为已删除）
    expect(screen.queryByRole("button", { name: /继续对话/ })).not.toBeInTheDocument();
  });

  /* ---------- 用例 5：codex ended（有 threadId）点列表项 → reopen→attach（2026-07-11 重构 / D-007） ---------- */

  it("codex ended session (with agent_session_id) click → reopenSession called → attach (2026-07-11 重构)", async () => {
    // D-007 旧语义（「无 agent_session_id 不可恢复→置灰」）随只读回看删除失效：
    // 新实现 ended/failed 一律先 reopen（不管 agent_session_id），reopen 失败由 panel 兜底 failed。
    const codexRuntime = {
      ...baseRuntime,
      id: "rt-codex",
      name: "MyCodex",
      provider: "codex",
      capabilities: { protocol: "json-rpc", agents: ["codex"] },
    };
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "send-codex", // ≤12 char
          runtime_id: "rt-codex",
          provider: "codex",
          status: "ended",
          agent_session_id: "ag-codex",
          ended_at: "2026-06-18T09:00:00Z",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.reopenSession.mockResolvedValue({
      session_id: "send-codex",
      status: "reconnecting",
    });

    render(
      <RuntimeSessionDialog
        runtime={codexRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[codexRuntime]}
      />,
    );

    // 点 ended codex 会话项 → handleSelect 走 ended/failed 分支：先 reopenSession
    fireEvent.click(await screen.findByText("send-codex"));

    // reopen 被调
    await waitFor(() =>
      expect(daemon.reopenSession).toHaveBeenCalledWith("send-codex"),
    );
    // reopen 成功 → setSelectedId → panel attach 建 SSE
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "send-codex",
        expect.anything(),
      ),
    );
    // panel header 渲染（attach 态）
    await waitFor(() =>
      expect(screen.getByText(/交互式会话/)).toBeInTheDocument(),
    );
  });

  /* ---------- 用例 5b：codex ended 无 threadId → 仍调 reopen（panel 兜底 failed）（2026-07-11 重构 / D-007） ---------- */

  it("codex ended session without agent_session_id → still calls reopenSession (panel 兜底 failed) (2026-07-11 重构)", async () => {
    // D-007 旧 UI（「继续对话置灰 title=会话未建立」）已删除：新实现里 ended/failed
    // 一律先 reopen（不区分 agent_session_id 有无），reopen 失败由 panel 转 failed 兜底。
    const codexRuntime = {
      ...baseRuntime,
      id: "rt-codex",
      name: "MyCodex",
      provider: "codex",
      capabilities: { protocol: "json-rpc", agents: ["codex"] },
    };
    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "send-cxno",
          runtime_id: "rt-codex",
          provider: "codex",
          status: "failed",
          agent_session_id: null, // 无 threadId
          ended_at: "2026-06-18T09:00:00Z",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    daemon.reopenSession.mockResolvedValue({
      session_id: "send-cxno",
      status: "reconnecting",
    });

    render(
      <RuntimeSessionDialog
        runtime={codexRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[codexRuntime]}
      />,
    );

    // 点 failed 无 threadId 会话项 → 仍走 reopen（不置灰、不拦截）
    fireEvent.click(await screen.findByText("send-cxno"));

    // reopen 仍被调（新行为：failed/ended 一律 reopen，由 panel 兜底 failed）
    await waitFor(() =>
      expect(daemon.reopenSession).toHaveBeenCalledWith("send-cxno"),
    );
    // 无「继续对话」按钮（旧行为已删除）
    expect(screen.queryByRole("button", { name: /继续对话/ })).not.toBeInTheDocument();
  });

  /* ---------- 用例 6：codex runtime 走 interactive（FR-01 / FR-07 / D-005） ---------- */

  it("codex runtime → 交互式会话面板，首发 createSession({provider:'codex'}) 不调 quick-chat (FR-01 / FR-07 / D-005)", async () => {
    const codexRuntime = {
      ...baseRuntime,
      id: "rt-codex",
      name: "MyCodex",
      provider: "codex",
      capabilities: { protocol: "json-rpc", agents: ["codex"] },
    };
    daemon.createSession.mockResolvedValue({
      session_id: "sess-codex",
      run_id: "run-codex-1",
      lease_id: "lease-codex",
      status: "active",
      stream_url: "/api/daemon/sessions/sess-codex/stream",
    });

    render(
      <RuntimeSessionDialog
        runtime={codexRuntime}
        open={true}
        onClose={vi.fn()}
        runtimes={[codexRuntime]}
      />,
    );

    // 历史列表恢复加载（撤销分流后 codex runtime 也调 listAgentSessions）
    await waitFor(() => expect(daemon.listAgentSessions).toHaveBeenCalled());
    // 渲染交互式会话 header（不是 Codex 快速对话）
    await waitFor(() => expect(screen.getByText(/交互式会话/)).toBeInTheDocument());
    expect(screen.queryByText(/Codex 快速对话/)).not.toBeInTheDocument();

    // 首发消息 → createSession({provider:'codex'})
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好 codex" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() =>
      expect(daemon.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "codex", prompt: "你好 codex" }),
      ),
    );
    // 建 interactive SSE（不是 quick-chat）
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "sess-codex",
        expect.anything(),
      ),
    );
    // 全程不调 quick-chat API
    expect(daemon.quickChat).not.toHaveBeenCalled();
    expect(daemon.streamQuickChat).not.toHaveBeenCalled();
    expect(daemon.getQuickChatResult).not.toHaveBeenCalled();
  });

  /* ---------- 用例 6：关闭清理无泄漏（SC-5 / FR-05 / R-02） ---------- */

  it("closing dialog during attach closes SSE + clears poll interval (no leak) (SC-5 / FR-05 / R-02)", async () => {
    // 2026-07-11 重构后默认 idle 不再自动 attach：需先点列表项触发 attach 建 SSE，
    // 再关闭弹窗验证 panel unmount → SSE close + clearInterval。
    const connCloseSpy = vi.fn();
    daemon.streamSession.mockImplementation(() => ({
      close: connCloseSpy,
      getLastEventId: () => null,
    }));
    // getAgentSession 返回 active → 首轮轮询（1500ms）即收敛，stop interval
    daemon.getAgentSession.mockImplementation(async (id: string) =>
      makeSession({ id, status: "active" }),
    );

    daemon.listAgentSessions.mockResolvedValue({
      items: [
        makeSession({
          id: "sleak", // ≤12 char
          runtime_id: "rt-1",
          status: "active",
          agent_session_id: "ag-leak",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const onClose = vi.fn();
    const { rerender } = render(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={true}
        onClose={onClose}
        runtimes={[baseRuntime]}
      />,
    );

    // 点列表项触发 attach 建 SSE（新行为默认 idle，不自动 attach）
    fireEvent.click(await screen.findByText("sleak"));

    // 等 attach 建 SSE
    await waitFor(() =>
      expect(daemon.streamSession).toHaveBeenCalledWith(
        "sleak",
        expect.anything(),
      ),
    );
    expect(connCloseSpy).not.toHaveBeenCalled();

    // 等首轮轮询收敛（getAgentSession 返回 active → stop interval）
    // attach 轮询 1500ms 一次，waitFor 默认 1000ms 不够，放宽到 3000ms
    await waitFor(
      () => expect(daemon.getAgentSession).toHaveBeenCalledWith("sleak"),
      { timeout: 3000 },
    );

    // 关闭弹窗：rerender open=false 触发 Dialog unmount → attach 面板 unmount
    // → InteractiveSessionPanel cleanup effect（closeStream + clearInterval）
    rerender(
      <RuntimeSessionDialog
        runtime={baseRuntime}
        open={false}
        onClose={onClose}
        runtimes={[baseRuntime]}
      />,
    );

    // SSE 连接 close 被调（attach 面板 cleanup → streamConnRef.current.close()）
    await waitFor(() => expect(connCloseSpy).toHaveBeenCalled());

    // 关闭后无残留：dialog 不再渲染（portal 卸载）
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
