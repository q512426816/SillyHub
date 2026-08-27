// task-09（2026-08-27-session-token-usage-fix / FR-01 / FR-02 / D-003）：
// SessionPanel page 模式上下文环（CtxUsageRing）分子口径固化测试。
//
// 覆盖（design §2 FR-01 / §5 Phase 3.2-3.3）：
//   - 环分子 = displayTurns 逆序第一个非 null 的 ctxTokens（不再 Σ inputTokens）；
//   - 全 null（历史会话 / 旧 daemon 不上报 ctx）→ 环未知态「—」，不算 0.0%；
//   - SSE tokens 事件携带 ctx_tokens → 运行中轮实时刷新（环立即变）；
//   - runsMeta 回填（GET /sessions/{id}/runs 返回 ctx_tokens）→ 历史轮进环。
//
// 取舍说明：环只渲染在 SessionPanelPage（dialog 分支 R7 无 CtxUsageBar），故本文件
// 用 page 模式直测。mock 模板 = session-panel-variant.test.tsx（page 模式网络层
// 全 mock + QueryClientProvider）+ session-panel-dialog.test.tsx 的 stream factory
// （route 扩展 "tokens" 事件分发到 onTokens）。
//
// mock：@/lib/daemon 整网络层 mock（streamSession 走 fake connection factory，
// 不建真实 EventSource）；MarkdownText mock 纯文本（jsdom 下 next/dynamic 得 null）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import type {
  SessionRunRead,
  SessionStreamConnection,
  SessionStreamHandlers,
} from "@/lib/daemon";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 session-panel-variant.test.tsx 模板）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（同 session-panel-variant.test.tsx 模板） ----- */

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
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
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

// page 模式 workspacesQuery（工作区名解析）+ TeamTriggerPopover 项目下拉数据源。
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

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据。
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({ items: [] }),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>(
    "@/lib/agent-profiles",
  );
  return { ...actual, useMineAgentProfiles: () => ({ profiles: [] }) };
});
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>(
    "@/lib/api/llm-providers",
  );
  return { ...actual, listProviders: vi.fn().mockResolvedValue([]) };
});

/* ----- fake SSE connection（session-panel-dialog.test.tsx stream factory 模式，
   route 扩展 "tokens" 事件 → onTokens 分发） ----- */

interface FakeConnHandlers {
  onTurnStarted: (env: any) => void;
  onLog: (env: any, cursor?: string | null) => void;
  onTurnCompleted: (env: any) => void;
  onSessionEnded: (env: any) => void;
  onTokens: (env: any) => void;
  onError: (err: Error) => void;
  route: (env: any, cursor?: string | null) => void;
}

interface FakeConn extends SessionStreamConnection {
  handlers: FakeConnHandlers;
  closeSpy: ReturnType<typeof vi.fn>;
}

function makeStreamMock(): { conn: FakeConn; factory: ReturnType<typeof vi.fn> } {
  let captured: FakeConn | null = null;
  const factory = vi.fn(
    (_sessionId: string, handlers: SessionStreamHandlers): FakeConn => {
      const closeSpy = vi.fn();
      captured = {
        close: closeSpy,
        getLastEventId: () => null,
        closeSpy,
        handlers: {
          onTurnStarted: (env: any) => handlers.onTurnStarted(env),
          onLog: (env: any, cursor?: string | null) => handlers.onLog(env, cursor ?? null),
          onTurnCompleted: (env: any) => handlers.onTurnCompleted(env),
          onSessionEnded: (env: any) => handlers.onSessionEnded(env),
          onTokens: (env: any) => handlers.onTokens?.(env),
          onError: (err: Error) => handlers.onError(err),
          // 便捷：用 envelope.event 路由（含 tokens → onTokens）
          route: (env: any, cursor?: string | null) => {
            switch (env.event) {
              case "turn_started": handlers.onTurnStarted(env); break;
              case "log": handlers.onLog(env, cursor ?? null); break;
              case "turn_completed": handlers.onTurnCompleted(env); break;
              case "session_ended": handlers.onSessionEnded(env); break;
              case "tokens": handlers.onTokens?.(env); break;
            }
          },
        },
      };
      return captured;
    },
  );
  return {
    get conn() { return captured!; },
    factory,
  };
}

/** SSE envelope 固件（字段缺省对齐 SessionStreamEnvelope 空值语义）。 */
function makeEnvelope(
  event: string,
  overrides: Record<string, any> = {},
): any {
  return {
    event,
    session_id: "sess-ctx",
    run_id: null,
    turn: null,
    log_id: null,
    timestamp: "2026-08-27T10:00:00Z",
    channel: null,
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    input_tokens: null,
    output_tokens: null,
    ...overrides,
  };
}

/* ----- fixture ----- */

/** attach 详情（page detailQuery；llm_provider_id=null → 无分母，环直显分子格式化值）。 */
function makeDetail() {
  return {
    id: "sess-ctx",
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
    title: "上下文环会话",
    config_snapshot: null,
  };
}

/** GET /sessions/{id}/runs 行（ctx_tokens 语义见 daemon.ts SessionRunRead 注释）。 */
function makeRun(overrides: Partial<SessionRunRead> = {}): SessionRunRead {
  return {
    id: "r-1",
    status: "completed",
    error_code: null,
    error_detail: null,
    started_at: "2026-08-27T10:00:00Z",
    finished_at: "2026-08-27T10:00:10Z",
    exit_code: 0,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: null,
    output_tokens: null,
    ctx_tokens: null,
    user_id: null,
    sender_name: null,
    ...overrides,
  };
}

/** page 模式挂载（环只在 SessionPanelPage 渲染，dialog 分支 R7 无 CtxUsageBar）。 */
function setupPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId="sess-ctx"
        machines={[]}
        llmProviders={[]}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
    created_at: "2026-08-27T10:00:00Z",
  });
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  // 默认无历史日志（turns 全由 runsMeta 孤儿轮 / SSE 驱动，排序最简可控）。
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

/* ───────── FR-01：环分子逆序取最新非 null ctxTokens（非 Σ inputTokens） ───────── */

describe("SessionPanel ctx 环分子口径（逆序最新非 null）", () => {
  it("三轮 [500, 800, null]（时间序）→ 环显最新非 null 800，非求和 1.3k、非最新 null 的未知态", async () => {
    // 时间序：r-1（最旧，ctx=500）→ r-2（ctx=800）→ r-3（最新，ctx=null）。
    // 旧口径 Σ inputTokens 会显示 1.3k（design §1.1 失真根因），新口径取 800。
    sessionApi.listSessionRuns.mockResolvedValue([
      makeRun({
        id: "r-1",
        started_at: "2026-08-27T10:00:00Z",
        finished_at: "2026-08-27T10:00:10Z",
        input_tokens: 500,
        ctx_tokens: 500,
      }),
      makeRun({
        id: "r-2",
        started_at: "2026-08-27T11:00:00Z",
        finished_at: "2026-08-27T11:00:10Z",
        input_tokens: 800,
        ctx_tokens: 800,
      }),
      makeRun({
        id: "r-3",
        started_at: "2026-08-27T12:00:00Z",
        finished_at: "2026-08-27T12:00:10Z",
        input_tokens: 300,
        ctx_tokens: null,
      }),
    ]);

    setupPage();

    const ring = await screen.findByTestId("ctx-ring");
    await waitFor(() => {
      expect(ring).toHaveTextContent("800");
    });
    // 非求和（500+800+300=1.6k / 仅 ctx 求和 1.3k 均不得出现）
    expect(ring.textContent).not.toContain("1.3k");
    expect(ring.textContent).not.toContain("1.6k");
    // 无分母（llm_provider_id=null）→ 直显分子格式化值，不算百分比
    expect(ring.textContent).not.toContain("%");
  });

  it("全 null（含老 run 行缺 ctx_tokens 键）→ 环未知态「—」，不显示 0.0%", async () => {
    // D-003：历史会话 / 旧 daemon 无 ctx 上报 → 环未知态；一行缺键（老后端兼容）
    // 一行显式 null，均按 null 处理。
    sessionApi.listSessionRuns.mockResolvedValue([
      makeRun({ id: "r-old-1", input_tokens: 1234, ctx_tokens: null }),
      makeRun({ id: "r-old-2", input_tokens: 5678, ctx_tokens: undefined }),
    ]);

    setupPage();

    const ring = await screen.findByTestId("ctx-ring");
    await waitFor(() => {
      expect(ring).toHaveTextContent("—");
    });
    // 未知态不算百分比（旧 Σ=0 口径的 0.0% 坑，X-09）
    expect(ring.textContent).not.toContain("%");
    expect(ring.textContent).not.toContain("0.0%");
    // 有历史 input_tokens 也不得回退旧口径求和（1.2k / 5.7k / 6.9k 均不出现）
    expect(ring.textContent).not.toContain("6.9k");
  });
});

/* ───────── FR-01：SSE tokens 事件实时刷新（运行中轮 ctxTokens last-write-wins） ───────── */

describe("SessionPanel ctx 环 SSE 实时更新", () => {
  it("tokens 事件带 ctx_tokens → 运行中轮实时刷新（环立即变）；null 不覆盖已收值", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);

    setupPage();
    await waitFor(() => expect(sessionApi.streamSession).toHaveBeenCalledTimes(1));

    // 初始（无 runs、无实时事件）→ 环未知态
    const ring = screen.getByTestId("ctx-ring");
    await waitFor(() => {
      expect(ring).toHaveTextContent("—");
    });

    const conn = stream.conn;
    // 建运行中轮 + 首次 tokens 上报 ctx_tokens=1200 → 环立即变 1.2k
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_started", { run_id: "r-live", turn: 1 }),
      );
      conn.handlers.route(
        makeEnvelope("tokens", {
          run_id: "r-live",
          input_tokens: 100,
          output_tokens: 20,
          ctx_tokens: 1200,
        }),
      );
    });
    await waitFor(() => {
      expect(ring).toHaveTextContent("1.2k");
    });

    // 后续 tokens 上报新值 → 环跟着变（last-write-wins 瞬时量）
    act(() => {
      conn.handlers.route(
        makeEnvelope("tokens", {
          run_id: "r-live",
          input_tokens: 200,
          output_tokens: 40,
          ctx_tokens: 999,
        }),
      );
    });
    await waitFor(() => {
      expect(ring).toHaveTextContent("999");
    });

    // 旧 daemon 形态：tokens 事件不带 ctx_tokens（undefined）→ 不覆盖已收值
    act(() => {
      conn.handlers.route(
        makeEnvelope("tokens", {
          run_id: "r-live",
          input_tokens: 300,
          output_tokens: 60,
        }),
      );
    });
    // 环保持 999（不被重置回未知态「—」）
    await waitFor(() => {
      expect(ring).toHaveTextContent("999");
    });
  });
});

/* ───────── FR-01：runsMeta 回填（GET runs ctx_tokens → 历史轮进环） ───────── */

describe("SessionPanel ctx 环 runsMeta 历史回填", () => {
  it("GET runs 返回 ctx_tokens → 历史轮填充，环从未知态「—」变为该值", async () => {
    // 延迟 resolve：先观察回填前的未知态，再放行 runs 响应验证回填路径。
    let resolveRuns: (runs: SessionRunRead[]) => void = () => {};
    sessionApi.listSessionRuns.mockImplementation(
      () =>
        new Promise<SessionRunRead[]>((resolve) => {
          resolveRuns = resolve;
        }),
    );

    setupPage();

    const ring = await screen.findByTestId("ctx-ring");
    await waitFor(() => {
      expect(ring).toHaveTextContent("—");
    });

    // attach 拉回的历史 run 带 ctx_tokens=1500 → 孤儿轮回填，环变 1.5k
    await act(async () => {
      resolveRuns([
        makeRun({
          id: "r-hist",
          started_at: "2026-08-27T09:00:00Z",
          finished_at: "2026-08-27T09:00:10Z",
          ctx_tokens: 1500,
        }),
      ]);
    });
    await waitFor(() => {
      expect(ring).toHaveTextContent("1.5k");
    });
  });
});
