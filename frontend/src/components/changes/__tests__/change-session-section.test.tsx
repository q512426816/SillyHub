/**
 * task-15（2026-07-09-change-detail-session / FR-05）：ChangeSessionSection 组件测试。
 *
 * 覆盖 task-13 验收：
 *   - 渲染时调 listChangeSessions，列表显示历史项（标题/作者/状态）
 *   - 点击「新建会话」→ Panel 进入新建（attachSessionId 不传）
 *   - 点击历史项 → Panel attachSessionId 设为该 session（切换恢复）
 *   - 新建会话 createSession payload 含 change_id
 *
 * mock 模式复用 interactive-session-panel.test.tsx / runtime-session-dialog.test.tsx：
 *   vi.mock @/lib/daemon + vi.hoisted + FakeES EventSource + markdown-text 纯文本
 *   （memory frontend-markdown-text-jsdom-null：next/dynamic jsdom 下渲染 null）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { ChangeSessionSection } from "@/components/changes/change-session-section";
import { useSession } from "@/stores/session";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)。
// mock 成纯文本渲染（测 section 交互逻辑，不测 markdown 库）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock lib/daemon ----- */

const sessionApi = vi.hoisted(() => ({
  listChangeSessions: vi.fn(),
  listDaemonRuntimes: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  fetchPendingDialogs: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listChangeSessions: sessionApi.listChangeSessions,
    listDaemonRuntimes: sessionApi.listDaemonRuntimes,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
  };
});

/* ----- fake SSE connection（与 interactive-session-panel.test 同构） ----- */

interface FakeConn extends ReturnType<typeof vi.fn> {}

function makeStreamMock(): { factory: FakeConn } {
  const factory = vi.fn((_sessionId: string, _handlers: any): any => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  return { factory };
}

function setup(overrides: { sessions?: any[]; runtimes?: any[] } = {}) {
  sessionApi.listChangeSessions.mockResolvedValue(
    overrides.sessions ?? [
      {
        id: "sess-1",
        provider: "claude",
        status: "active",
        turn_count: 3,
        author: { user_id: "u-1", display_name: "张三" },
        last_active_at: "2026-07-09T10:00:00Z",
        title: "关于扫描结果的讨论",
      },
      {
        id: "sess-2",
        provider: "codex",
        status: "ended",
        turn_count: 1,
        author: { user_id: "u-2", display_name: "李四" },
        last_active_at: "2026-07-08T10:00:00Z",
        title: null,
      },
    ],
  );
  sessionApi.listDaemonRuntimes.mockResolvedValue(
    overrides.runtimes ?? [
      { id: "rt-1", provider: "claude", status: "online" },
      { id: "rt-2", provider: "codex", status: "online" },
    ],
  );
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  return render(
    <ChangeSessionSection workspaceId="ws-1" changeId="change-1" />,
  );
}

describe("ChangeSessionSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // useSession.getState() 在 streamSession 内被读（取 accessToken），提供空态
    useSession.setState({ accessToken: null } as any);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("渲染时调 listChangeSessions(ws-1, change-1)，列表显示历史项（标题/作者）", async () => {
    setup();

    await waitFor(() =>
      expect(sessionApi.listChangeSessions).toHaveBeenCalledWith("ws-1", "change-1"),
    );
    // 历史项渲染：标题 + 作者（secondaryText 合并「作者 · 提供方」）
    expect(await screen.findByText("关于扫描结果的讨论")).toBeInTheDocument();
    expect(screen.getByText(/张三/)).toBeInTheDocument();
    // 无 title 项回退 shortId
    expect(screen.getByText(/李四/)).toBeInTheDocument();
  });

  it("空列表显示「暂无会话」占位", async () => {
    setup({ sessions: [] });
    expect(await screen.findByText(/暂无会话/)).toBeInTheDocument();
  });

  it("默认（未选中历史）Panel 走新建：attachSessionId 不传，首发 createSession 带 change_id", async () => {
    const { factory } = makeStreamMock();
    sessionApi.streamSession.mockImplementation(factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-new",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });

    setup();
    // 等待 runtimes / sessions 挂载完成
    await screen.findByPlaceholderText(/创建会话/);

    // attachSessionId 未传 → 不立刻建 SSE / 轮询
    expect(sessionApi.streamSession).not.toHaveBeenCalled();

    // 发送首条 → createSession payload 含 change_id + workspace_id
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude",
        prompt: "你好",
        change_id: "change-1",
        workspace_id: "ws-1",
      }),
    );
  });

  it("点击历史项 → Panel attachSessionId 设为该 session（切换恢复，建 SSE）", async () => {
    const { factory } = makeStreamMock();
    sessionApi.streamSession.mockImplementation(factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-1", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });

    setup();
    // 点击第一个历史项
    const item = await screen.findByText("关于扫描结果的讨论");
    fireEvent.click(item);

    // attachSessionId = sess-1 → Panel 建 SSE + 拉 logs 预填
    await waitFor(() => {
      expect(sessionApi.streamSession).toHaveBeenCalledTimes(1);
      expect(sessionApi.streamSession.mock.calls[0]![0]).toBe("sess-1");
    });
    expect(sessionApi.getAgentSessionLogs).toHaveBeenCalledWith("sess-1");
    // 选中的 attach 模式不再走 createSession 新建
    expect(sessionApi.createSession).not.toHaveBeenCalled();
  });

  it("点击「新建会话」按钮 → 清空选中，Panel 回 idle（attachSessionId 不传）", async () => {
    const { factory } = makeStreamMock();
    sessionApi.streamSession.mockImplementation(factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-1", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });

    setup();
    // 先选中历史项（触发 attach + SSE）
    const item = await screen.findByText("关于扫描结果的讨论");
    fireEvent.click(item);
    await waitFor(() => expect(sessionApi.streamSession).toHaveBeenCalled());

    // 点「新建会话」按钮（左栏顶部，title=新建会话）
    // 注意 Panel 内部也有一个 title=新建会话 按钮，这里精确选侧栏的
    const newBtns = screen.getAllByTitle("新建会话");
    // 左栏侧栏的按钮在 aside 内
    const asideNewBtn = newBtns.find((btn) =>
      (btn.closest("aside") as HTMLElement | null) !== null,
    )!;
    fireEvent.click(asideNewBtn);

    // attachSessionId 清空 → Panel key 变化重 mount 回 idle
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/创建会话/)).toBeInTheDocument();
    });
  });

  it("createSession 成功后调 onSessionCreated → 写入 activeSessionId + 刷新列表", async () => {
    const { factory } = makeStreamMock();
    sessionApi.streamSession.mockImplementation(factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-created",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });

    setup();
    await screen.findByPlaceholderText(/创建会话/);
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "首条" } });
    fireEvent.click(screen.getByTitle("发送"));

    // createSession 成功 → listChangeSessions 被再次调用刷新列表
    await waitFor(() => {
      const calls = sessionApi.listChangeSessions.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(2);
    });
  });
});
