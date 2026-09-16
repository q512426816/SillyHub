// quick（ql-20260916-005）：会话页进入 /sessions/{id}/runs 请求扇出回归——
// 首连缺口同步 / 5s 复核会对 run 快照里每个终态 run 合成 turn_completed 重放，
// 页面 onTurnCompleted 历史上对每条事件无条件刷 runsMeta/用量信号（历史 T 轮
// → 2T 条并发 /runs）+ 失败轮逐 run 各拉一次全量列表（F 条）。修复后：
//   1. 重放终态事件不再触发刷新类副作用（首屏收敛为 runsMeta + 任务面板 2 条）；
//   2. 真实新完成轮照常触发刷新（快照 + 面板各 1 条）；
//   3. 失败详情拉取并发共享（同批 F 个失败重放 → 1 条）；
//   4. runsMeta 快照经 runsSnapshot 注入 streamSession（缺口同步复用，不再自拉）。
// mock 网络层模板同 session-panel-history-race.test.tsx。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SessionPanel } from "../session-panel";
import type { SessionRunRead } from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTasks: vi.fn().mockResolvedValue([]), // 任务执行面板快照（防真实 fetch）
  listSessionTeamMissions: vi.fn(),
  fetchSessionQueue: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTasks: sessionApi.listSessionTasks,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
  };
});

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: vi.fn().mockResolvedValue({ items: [] }) };
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

/* ----- fixture ----- */

/** 3 个历史 run（run-h1..h3），可选标记失败轮。 */
const HISTORY_RUNS = ["run-h1", "run-h2", "run-h3"];
let failedRunIds: Set<string>;

function makeDetail(id: string) {
  return {
    id,
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: `ag-${id}`,
    config: null,
    turn_count: 3,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: "ws-1",
    llm_provider_id: null,
    agent_profile_id: null,
    title: `会话${id}`,
    config_snapshot: null,
  };
}

function makeHistory() {
  return HISTORY_RUNS.flatMap((runId, i) => [
    {
      id: `log-${runId}-u`,
      run_id: runId,
      timestamp: `2026-09-16T10:00:0${i}.000Z`,
      channel: "user_input",
      content_redacted: `问题${i}`,
    },
    {
      id: `log-${runId}-o`,
      run_id: runId,
      timestamp: `2026-09-16T10:00:0${i}.500Z`,
      channel: "stdout",
      content_redacted: `回答${i}`,
    },
  ]);
}

/** 模拟 dispatchRunSynth 产出的合成 turn_completed envelope。 */
function makeCompletedEnv(runId: string, status: string) {
  return {
    event: "turn_completed" as const,
    session_id: "sess-A",
    run_id: runId,
    turn: null,
    log_id: null,
    timestamp: "2026-09-16T10:00:09.000Z",
    channel: null,
    content: null,
    status,
    exit_code: status === "failed" ? 1 : null,
    reason: null,
    input_tokens: null,
    output_tokens: null,
  };
}

/** streamSession 捕获的 handlers（connGuard 包装后仍透传 onTurnCompleted）。 */
type CapturedStreamHandlers = {
  onTurnCompleted: (_env: ReturnType<typeof makeCompletedEnv>) => void;
};
let capturedHandlers: CapturedStreamHandlers | null = null;

function Host({ sessionId }: { sessionId: string; children?: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionPanel mode="page" sessionId={sessionId} machines={[]} llmProviders={[]} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  failedRunIds = new Set();
  capturedHandlers = null;
  sessionApi.getAgentSession.mockImplementation(async (sid: string) => makeDetail(sid));
  sessionApi.getAgentSessionLogs.mockImplementation(async () => makeHistory());
  sessionApi.listSessionRuns.mockImplementation(async () =>
    HISTORY_RUNS.map((id) => ({
      id,
      created_at: "2026-09-16T10:00:00Z",
      spec_strategy: null,
      status: failedRunIds.has(id) ? "failed" : "completed",
      error_code: null,
      failure_summary: null,
      error_detail: failedRunIds.has(id)
        ? { type: "api_error", code: "rate_limited", message: "boom", retryable: false, hint: null }
        : null,
      started_at: "2026-09-16T10:00:01Z",
      finished_at: "2026-09-16T10:00:02Z",
      exit_code: 0,
      agent_profile_snapshot: null,
      llm_provider_id: null,
      input_tokens: null,
      output_tokens: null,
      user_id: null,
      sender_name: null,
    })),
  );
  sessionApi.streamSession.mockImplementation(
    (_sid: string, handlers: CapturedStreamHandlers, _opts?: unknown) => {
      capturedHandlers = handlers;
      // 模拟首连缺口同步：对每个历史 run 合成 turn_completed（真实 streamSession
      // syncGapFromDb 对全量终态 run 的批量重放行为），建流瞬间同步扇出。
      for (const runId of HISTORY_RUNS) {
        handlers.onTurnCompleted?.(
          makeCompletedEnv(runId, failedRunIds.has(runId) ? "failed" : "completed"),
        );
      }
      return { close: vi.fn(), getLastEventId: () => null };
    },
  );
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
});

async function renderAndSettle() {
  render(<Host sessionId="sess-A" />);
  await waitFor(() => {
    expect(screen.getAllByText(/回答\d/).length).toBe(HISTORY_RUNS.length);
  });
  await act(async () => {});
}

// ── quick（ql-20260916-010）：未加载历史轮占位骨架回归 ─────────────────────
// 会话快照含未加载轮（log 窗口外的历史 run）时，翻页前显示带配置行/时间的
// 轻量占位 turn（复用「静默切换轮紧凑标记」渲染），翻页到达后装配块替换。
describe("未加载历史轮占位骨架（ql-20260916-010）", () => {
  it("快照含未加载历史轮 → 渲染配置行骨架（时间+档案+供应商）", async () => {
    // makeHistory 只含 run-h1..h3 的日志；HISTORY_RUNS 快照同集——无未加载轮。
    // 追加一个不在日志里的 run-h4 快照行（历史窗口外），其占位骨架应渲染。
    sessionApi.listSessionRuns.mockImplementation(async () => {
      const rows: SessionRunRead[] = HISTORY_RUNS.map((id) => ({
        id,
        created_at: "2026-09-16T10:00:00Z",
        spec_strategy: null,
        status: failedRunIds.has(id) ? "failed" : "completed",
        error_code: null,
        failure_summary: null,
        error_detail: null,
        started_at: "2026-09-16T10:00:01Z",
        finished_at: "2026-09-16T10:00:02Z",
        exit_code: 0,
        agent_profile_snapshot: null,
        llm_provider_id: null,
        input_tokens: null,
        output_tokens: null,
        user_id: null,
        sender_name: null,
      }));
      rows.push({
        id: "run-h4-unloaded",
        created_at: "2026-09-15T09:00:00Z",
        spec_strategy: null,
        status: "completed",
        error_code: null,
        failure_summary: null,
        error_detail: null,
        started_at: "2026-09-15T09:00:01Z",
        finished_at: "2026-09-15T09:00:02Z",
        exit_code: 0,
        agent_profile_snapshot: { name: "测试档案" },
        llm_provider_id: null,
        input_tokens: null,
        output_tokens: null,
        user_id: null,
        sender_name: "测试者",
      });
      return rows;
    });
    await renderAndSettle();
    // 占位骨架渲染配置行（档案名 chip）——文本被 <span>· <svg/> 档案名</span>
    // 拆成「· 」「测试档案」两段（紧凑行 render 结构），用函数匹配跨段取含档案名的段。
    await waitFor(() =>
      expect(
        screen.getAllByText((_, el) => el?.textContent === "·  测试档案").length,
      ).toBeGreaterThan(0),
    );
  });
});

describe("会话页 /runs 请求扇出收敛（ql-20260916-005）", () => {
  it("历史轮重放终态事件不扇出刷新：首屏仅 runsMeta + 任务面板 2 条（修复前 2+T 条）", async () => {
    await renderAndSettle();
    expect(sessionApi.listSessionRuns).toHaveBeenCalledTimes(2);
  });

  it("runsMeta 快照经 runsSnapshot 注入 streamSession（缺口同步复用宿主快照）", async () => {
    await renderAndSettle();
    const opts = sessionApi.streamSession.mock.calls[0]?.[2] as
      | { runsSnapshot?: { id: string }[] }
      | undefined;
    expect(opts?.runsSnapshot?.map((r) => r.id)).toEqual(HISTORY_RUNS);
  });

  it("真实新完成轮照常触发刷新（快照 + 用量信号→面板各 1 条）", async () => {
    await renderAndSettle();
    if (!capturedHandlers) throw new Error("streamSession 未建流（handlers 未捕获）");
    sessionApi.listSessionRuns.mockClear();
    capturedHandlers.onTurnCompleted(makeCompletedEnv("run-new", "completed"));
    await act(async () => {});
    expect(sessionApi.listSessionRuns).toHaveBeenCalledTimes(2);
  });

  it("失败轮错误详情并发共享：同批 2 个失败重放只拉 1 次（修复前 F 条）", async () => {
    failedRunIds = new Set(["run-h1", "run-h2"]);
    await renderAndSettle();
    // 基线 2（runsMeta + 面板）+ 错误详情共享 1 = 3（修复前 2 + 2 = 4，且不含
    // 修复前重放扇出的 refreshRunsMeta）。
    expect(sessionApi.listSessionRuns).toHaveBeenCalledTimes(3);
  });
});
