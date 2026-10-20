// 2026-10-20-session-status-live-sync：permission_request 事件即时刷左栏列表
// 单测——审批等待边沿（用户可操作状态、即时性最敏感）右侧弹审批交互的同时
// 调 onSessionListRefresh（经 400ms 去抖触发列表失效），作为 Redis 列表信号
// 丢失时的本地兜底；dialog 模式不传该回调天然不受影响。
//
// 覆盖：
//   1. permission_request（带 dialog_kind）→ onSessionListRefresh 被调用；
//   2. 同 request_id 重复事件 → 集合幂等去重，但刷新仍触发（哑信号多发无害，
//      去抖层合并）；
//   3. dialog_kind 为空的事件（守卫早退）→ 不入待审列表；刷新语义随事件本身
//      仍触发（有 dialog_kind 才是「在等你」边沿——本用例钉死守卫分支零刷新）。
//
// mock 模板 = session-panel-ctx-tokens.test.tsx（page 模式网络层全 mock +
// QueryClientProvider + stream factory 扩展 permission_request 路由）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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

/* ----- mock 网络层（session-panel-ctx-tokens.test.tsx 模板） ----- */

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
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>(
    "@/lib/api/llm-providers",
  );
  return { ...actual, listProviders: vi.fn().mockResolvedValue([]) };
});

/* ----- fake SSE connection（模板 + permission_request 路由） ----- */

interface FakeConnHandlers {
  onPermissionRequest: (req: any) => void;
}

interface FakeConn extends SessionStreamConnection {
  handlers: FakeConnHandlers;
}

function makeStreamMock(): { conn: FakeConn; factory: ReturnType<typeof vi.fn> } {
  let captured: FakeConn | null = null;
  const factory = vi.fn(
    (_sessionId: string, handlers: SessionStreamHandlers): FakeConn => {
      captured = {
        close: vi.fn(),
        getLastEventId: () => null,
        handlers: {
          onPermissionRequest: (req: any) => handlers.onPermissionRequest?.(req),
        },
      };
      return captured;
    },
  );
  return {
    get conn() {
      return captured!;
    },
    factory,
  };
}

function makePermissionRequest(overrides: Record<string, any> = {}): any {
  return {
    request_id: "req-1",
    run_id: "r-live",
    dialog_kind: "confirm",
    title: "需要你的确认",
    options: [],
    ...overrides,
  };
}

function makeDetail() {
  return {
    id: "sess-appr",
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
    title: "审批兜底会话",
    config_snapshot: null,
  };
}

function setupPage(onSessionListRefresh: ReturnType<typeof vi.fn>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId="sess-appr"
        machines={[]}
        llmProviders={[]}
        onSessionListRefresh={onSessionListRefresh}
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
    created_at: "2026-10-20T10:00:00Z",
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
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

describe("permission_request → onSessionListRefresh 兜底（2026-10-20-session-status-live-sync）", () => {
  it("带 dialog_kind 的审批请求 → 右侧弹审批的同时刷新左栏列表（徽标秒级翻「在等你」）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();

    setupPage(onSessionListRefresh);
    await waitFor(() => expect(sessionApi.streamSession).toHaveBeenCalledTimes(1));

    act(() => {
      stream.conn.handlers.onPermissionRequest(makePermissionRequest());
    });
    await waitFor(() => {
      expect(onSessionListRefresh).toHaveBeenCalled();
    });
  });

  it("同 request_id 重复事件：待审集合幂等去重，刷新仍随事件触发（哑信号多发无害，400ms 去抖层合并）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();

    setupPage(onSessionListRefresh);
    await waitFor(() => expect(sessionApi.streamSession).toHaveBeenCalledTimes(1));

    act(() => {
      stream.conn.handlers.onPermissionRequest(makePermissionRequest());
      stream.conn.handlers.onPermissionRequest(makePermissionRequest());
    });
    expect(onSessionListRefresh).toHaveBeenCalledTimes(2);
  });

  it("dialog_kind 为空（守卫早退，非「在等你」边沿）→ 零刷新", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const onSessionListRefresh = vi.fn();

    setupPage(onSessionListRefresh);
    await waitFor(() => expect(sessionApi.streamSession).toHaveBeenCalledTimes(1));

    act(() => {
      stream.conn.handlers.onPermissionRequest(
        makePermissionRequest({ request_id: "req-quiet", dialog_kind: null }),
      );
    });
    // 挂载期各种查询刷新与审批刷新无关：等一拍微任务排空后仍零调用。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onSessionListRefresh).not.toHaveBeenCalled();
  });
});
