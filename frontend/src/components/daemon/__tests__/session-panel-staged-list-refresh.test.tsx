// 2026-10-28-session-list-refresh-and-paging FR-01：暂存切换随消息发送生效后
// 左栏列表立即刷新——settleStagedAfterSend 补 onSessionListRefresh（此前该路径
// 漏调，仅能等 10s/30s 轮询兜底，用户看到的一直是新建时配置）。
//
// 覆盖：
//   1. 正例：配置条暂存供应商 → 发送消息受理成功 → onSessionListRefresh 被调
//      （列表 chips 即时刷新，不依赖轮询）；
//   2. 负例（零回归锚）：无暂存发送 → settle 早退，不触发列表刷新。
//
// mock 模板 = session-panel-approval-list-refresh.test.tsx（page 模式网络层全
// mock + QueryClientProvider；listProviders mock 换供应商 fixture 供暂存交互）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import type {
  SessionStreamConnection,
  SessionStreamHandlers,
} from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（approval 模板） ----- */

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchSessionTurnOutline: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchSessionTurnOutline: sessionApi.fetchSessionTurnOutline,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTasks: sessionApi.listSessionTasks,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

const workspaceApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  listProjectWorkspaces: vi.fn(),
}));

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: workspaceApi.listWorkspaces };
});

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return { ...actual, listProjects: workspaceApi.listProjects };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
});

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({ items: [] }),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>(
    "@/lib/agent-profiles",
  );
  return { ...actual, useMineAgentProfiles: () => ({ profiles: [] }) };
});

/** FR-01：暂存交互需要一个可选供应商（listProviders 内部查询数据源）。
 * fixture 内联进 mock 工厂（vi.mock hoisting：顶层变量不可引用）。 */
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>(
    "@/lib/api/llm-providers",
  );
  return {
    ...actual,
    listProviders: vi.fn().mockResolvedValue([
      { id: "prov-glm", name: "GLM 平台", models: [], agent_kinds: ["claude"], is_default: false },
    ]),
    listUsableProviders: vi.fn().mockResolvedValue([
      { id: "prov-glm", name: "GLM 平台", models: [], agent_kinds: ["claude"], is_default: false },
    ]),
  };
});

/* ----- fake SSE connection（approval 模板极简：无事件路由需求） ----- */

interface FakeConn extends SessionStreamConnection {
  close: ReturnType<typeof vi.fn>;
}

function makeStreamMock(): { conn: FakeConn | null; factory: ReturnType<typeof vi.fn> } {
  let captured: FakeConn | null = null;
  const factory = vi.fn(
    (_sessionId: string, _handlers: SessionStreamHandlers): FakeConn => {
      captured = {
        close: vi.fn(),
        getLastEventId: () => null,
      };
      return captured;
    },
  );
  return {
    get conn() {
      return captured;
    },
    factory,
  };
}

function makeDetail() {
  return {
    id: "sess-staged",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: "ag-1",
    config: null,
    turn_count: 1,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: null,
    llm_provider_id: null,
    agent_profile_id: null,
    title: "暂存切换会话",
    config_snapshot: null,
  };
}

function setupPage(
  onSessionListRefresh: ReturnType<typeof vi.fn>,
  sessionId = "sess-staged",
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId={sessionId}
        machines={[]}
        llmProviders={[]}
        onSessionListRefresh={onSessionListRefresh}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 2026-10-30-askuser-config-pending：stagedConfig 持久化用例隔离（jsdom
  // sessionStorage 跨用例存活，逐用例清空防串台）。
  window.sessionStorage.clear();
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  sessionApi.deleteSessionQueueEntry.mockResolvedValue(undefined);
  sessionApi.retrySessionQueueEntry.mockResolvedValue({
    id: "entry-1",
    prompt: "",
    attachment_ids: [],
    agent_profile_id: null,
    llm_provider_id: null,
    status: "pending",
    error_msg: null,
    created_at: "2026-10-28T10:00:00Z",
  });
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.fetchSessionTurnOutline.mockResolvedValue({
    session_id: "s-1",
    total_turns: 0,
    items: [],
  });
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.injectSession.mockResolvedValue({
    session_id: "sess-staged",
    run_id: "run-2",
    status: "pending",
    queued: false,
  });
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

describe("暂存切换随消息生效 → 左栏列表立即刷新（FR-01）", () => {
  it("正例：暂存供应商 → 发送受理成功 → onSessionListRefresh 被调（不等轮询）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();
    setupPage(onSessionListRefresh);

    // 配置条供应商按钮就绪（providers 查询到位）→ 点开 → 暂存选 GLM 平台。
    const providerBtn = await screen.findByRole("button", {
      name: /^配置-供应商/,
    });
    fireEvent.click(providerBtn);
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));

    // 输入消息并发送（空闲直发路径 → settleStagedAfterSend）。
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "继续" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());
    // FR-01：发送受理成功即触发列表刷新（chips 即时更新）。
    await waitFor(() => expect(onSessionListRefresh).toHaveBeenCalled());
  });

  it("负例（零回归锚）：无暂存发送 → 不触发列表刷新（settle 早退）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();
    setupPage(onSessionListRefresh);

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "普通追问" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());
    // 无暂存：settleStagedAfterSend 早退（stagedConfig 空），不刷列表。
    expect(onSessionListRefresh).not.toHaveBeenCalled();
  });
});

// ── 2026-10-30-askuser-config-pending FR-02/FR-03：stagedConfig sessionStorage 持久化 ──
// 写（实时，含 labels）/ 恢复（重挂载模拟刷新，按 sessionId 隔离）/ 清（发送成功
// 收敛）/ 坏数据静默丢弃（D-005）。key 族 sh:config-staged:<sessionId>（D-004）。

describe("stagedConfig sessionStorage 持久化（FR-02/FR-03）", () => {
  const STAGED_KEY = "sh:config-staged:sess-staged";

  /** 暂存供应商 GLM 的通用前置（providers 查询 + 点选）。 */
  async function stageProvider() {
    const providerBtn = await screen.findByRole("button", {
      name: /^配置-供应商/,
    });
    fireEvent.click(providerBtn);
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));
  }

  it("暂存变更实时写 sessionStorage（含供应商显示名 labels）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    setupPage(vi.fn());
    await stageProvider();

    await waitFor(() => {
      const raw = window.sessionStorage.getItem(STAGED_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({
        config: expect.objectContaining({ llm_provider_id: "prov-glm" }),
        labels: expect.objectContaining({ llm_provider_id: "GLM 平台" }),
      });
    });
  });

  it("刷新（重挂载）恢复暂存与高亮（供应商按钮显示暂存值+pending 态）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();
    const { unmount } = setupPage(onSessionListRefresh);
    await stageProvider();
    await waitFor(() =>
      expect(window.sessionStorage.getItem(STAGED_KEY)).not.toBeNull(),
    );

    // 刷新 = 卸载重挂（同一 sessionStorage 副本）
    unmount();
    setupPage(onSessionListRefresh);
    const providerBtn = await screen.findByRole("button", {
      name: "配置-供应商 GLM 平台",
    });
    expect(providerBtn).toHaveAttribute("data-staged-pending", "true");
  });

  it("切换会话不串台：另一会话（sess-other）挂载不读本会话条目", async () => {
    window.sessionStorage.setItem(
      STAGED_KEY,
      JSON.stringify({
        config: { llm_provider_id: "prov-glm" },
        labels: { llm_provider_id: "GLM 平台" },
      }),
    );
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockImplementation(async (id: string) => ({
      ...makeDetail(),
      id,
    }));
    setupPage(vi.fn(), "sess-other");
    // 恢复为空：供应商显示默认（未读 sess-staged 的暂存值）
    const providerBtn = await screen.findByRole("button", {
      name: /^配置-供应商/,
    });
    expect(providerBtn.textContent).not.toContain("GLM 平台");
    expect(providerBtn).not.toHaveAttribute("data-staged-pending");
    // 本会话 key 未被误写（sess-other 无暂存不建条目）
    expect(window.sessionStorage.getItem("sh:config-staged:sess-other")).toBeNull();
  });

  it("坏 JSON 静默丢弃：条目清除、不抛错、按空暂存处理（D-005）", async () => {
    window.sessionStorage.setItem(STAGED_KEY, "{not-json");
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    expect(() => setupPage(vi.fn())).not.toThrow();
    await screen.findByRole("button", { name: /^配置-供应商/ });
    // 坏条目已被清除
    expect(window.sessionStorage.getItem(STAGED_KEY)).toBeNull();
  });

  it("发送成功后暂存清空 + sessionStorage 条目移除（FR-02）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();
    setupPage(onSessionListRefresh);
    await stageProvider();
    await waitFor(() =>
      expect(window.sessionStorage.getItem(STAGED_KEY)).not.toBeNull(),
    );

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "继续" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());
    // 发送受理成功 → 暂存收敛 → 条目移除
    await waitFor(() =>
      expect(window.sessionStorage.getItem(STAGED_KEY)).toBeNull(),
    );
  });
});
