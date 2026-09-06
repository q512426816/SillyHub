/**
 * useSessionTasks 单测（2026-09-04-session-task-execution-panel task-10 被测、
 * task-06 实现 / FR-02 / FR-07 / D-001@v1 / D-003@v1 / D-006@v1）。
 *
 * 覆盖（任务卡 implementation 逐条，组织对齐 use-message-queue.test.ts 先例）：
 *   1. mount 按 sessionId 拉快照 → 视图行映射（taskId / 状态收窄 / 时间锚点解析 /
 *      updatedAt 元数据）；
 *   2. applyEvent 实时合并——首见 running 建条插队首 / 缺字段保旧值 / 终态定格
 *      吸收迟到 running 心跳（与后端 upsert 同构语义）；异会话事件静默丢弃；
 *   3. 快照与事件合并——快照终态行遇迟到 running 事件不回退（服务端为准）；
 *   4. sessionId 切换重拉、旧会话行不残留；预会话态（""）不发请求；
 *   5. refreshSignal 递增触发快照重拉（重连对账链路）；
 *   6. 空快照 [] 正常收敛不报错（FR-07 引擎不上报任务降级）；
 *   7. 失败口径（ql-20260903-014 同款）——404/409/422 竞态静默收敛；
 *      网络 / 5xx 真实失败 notify.error(err, "加载任务清单失败")。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useSessionTasks } from "@/hooks/use-session-tasks";
import { ApiError } from "@/lib/api";
import {
  listSessionTasks,
  type AgentSessionTaskRead,
  type AgentTaskStatusEvent,
} from "@/lib/daemon";

vi.mock("@/lib/daemon", () => ({
  listSessionTasks: vi.fn(),
}));

// hook 内 useNotify 需要可断言的 spy（errMessage 保真用真实现，对齐
// use-message-queue.test.ts 先例）。
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { errMessage: actual.errMessage, useNotify: () => notifyMock };
});

const mockedList = vi.mocked(listSessionTasks);

/** 快照行构造（AgentSessionTaskRead 生成类型全字段）。 */
function row(overrides: Partial<AgentSessionTaskRead> = {}): AgentSessionTaskRead {
  return {
    id: "row-1",
    session_id: "sess-1",
    run_id: "run-1",
    task_id: "bg-1",
    task_name: "后台调研",
    status: "running",
    progress: null,
    summary: null,
    message: null,
    last_tool_name: null,
    tool_use_id: null,
    elapsed_ms: null,
    total_tokens: null,
    tool_uses: null,
    is_async: false,
    started_at: null,
    finished_at: null,
    updated_at: "2026-09-04T10:00:00Z",
    ...overrides,
  };
}

/** 归一化后的实时事件构造。 */
function ev(overrides: Partial<AgentTaskStatusEvent> = {}): AgentTaskStatusEvent {
  return {
    event: "agent_task_status",
    session_id: "sess-1",
    run_id: "run-1",
    task_id: "bg-1",
    task_name: "后台调研",
    status: "running",
    progress: null,
    message: null,
    ...overrides,
  };
}

/** ApiError 构造（ql-20260903-014 口径断言用）。 */
function apiError(status: number): ApiError {
  return new ApiError(status, {
    code: `http_${status}`,
    message: "错误",
    request_id: null,
    details: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSessionTasks（task-06 / FR-02 / FR-07）", () => {
  it("mount 拉快照并映射视图行（字段映射 / 状态收窄 / 时间锚点解析 / updatedAt）", async () => {
    mockedList.mockResolvedValue([
      row({
        task_id: "bg-1",
        task_name: "后台调研",
        status: "completed",
        elapsed_ms: 65_000,
        summary: "调研完成",
        total_tokens: 12_345,
        started_at: "2026-09-04T09:59:00Z",
        finished_at: "2026-09-04T10:00:05Z",
        updated_at: "2026-09-04T10:00:05.500Z",
      }),
      row({ id: "row-2", task_id: "bg-2", status: "weird-value" }),
    ]);

    const { result } = renderHook(() => useSessionTasks("sess-1"));

    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    expect(mockedList).toHaveBeenCalledWith("sess-1");
    expect(result.current.loading).toBe(false);
    expect(result.current.tasks[0]).toMatchObject({
      taskId: "bg-1",
      taskName: "后台调研",
      status: "completed",
      summary: "调研完成",
      totalTokens: 12_345,
      // elapsed_ms 到达 → 校准锚点回填（快照抵达本地时刻）
      elapsedSyncedAt: expect.any(Number),
      startedAt: Date.parse("2026-09-04T09:59:00Z"),
      terminalAt: Date.parse("2026-09-04T10:00:05Z"),
      updatedAt: "2026-09-04T10:00:05.500Z",
      runId: "run-1",
    });
    // 未知 status 收窄为 stopped（持久化清单不转圈）
    expect(result.current.tasks[1]).toMatchObject({ taskId: "bg-2", status: "stopped" });
  });

  it("预会话态（sessionId 空串）不发请求、清单为空", async () => {
    const { result } = renderHook(() => useSessionTasks(""));
    await act(async () => {});
    expect(mockedList).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("applyEvent 首见 running 建条插队首；心跳缺字段保旧值；终态定格吸收迟到 running", async () => {
    mockedList.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTasks("sess-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 首见 running → 建条插队首
    act(() => {
      result.current.applyEvent(ev({ task_id: "bg-live", task_name: "实时任务" }));
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]).toMatchObject({
      taskId: "bg-live",
      status: "running",
      runId: "run-1",
      updatedAt: null, // 事件载荷无 updated_at
    });

    // 心跳带扩展字段 → 只增不减
    act(() => {
      result.current.applyEvent(
        ev({ task_id: "bg-live", last_tool_name: "Bash", summary: "跑测试中", total_tokens: 800 }),
      );
    });
    expect(result.current.tasks[0]).toMatchObject({
      lastToolName: "Bash",
      summary: "跑测试中",
      totalTokens: 800,
    });
    // 再来缺 summary / tokens 的心跳 → 旧值保留
    act(() => {
      result.current.applyEvent(ev({ task_id: "bg-live", elapsed_ms: 30_000 }));
    });
    expect(result.current.tasks[0]).toMatchObject({
      summary: "跑测试中",
      totalTokens: 800,
      elapsedMs: 30_000,
    });

    // 终态定格
    act(() => {
      result.current.applyEvent(
        ev({ task_id: "bg-live", status: "failed", elapsed_ms: 60_000, message: "进程退出" }),
      );
    });
    expect(result.current.tasks[0]).toMatchObject({ status: "failed", elapsedMs: 60_000 });
    // 迟到 running 心跳不回退（终态吸收态）
    act(() => {
      result.current.applyEvent(ev({ task_id: "bg-live", last_tool_name: "Late" }));
    });
    expect(result.current.tasks[0]).toMatchObject({ status: "failed", lastToolName: "Bash" });
  });

  it("快照终态行遇迟到 running 事件不回退（快照 + 事件合并，服务端为准）", async () => {
    mockedList.mockResolvedValue([
      row({ task_id: "bg-1", status: "completed", summary: "已完成" }),
    ]);
    const { result } = renderHook(() => useSessionTasks("sess-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    act(() => {
      result.current.applyEvent(ev({ task_id: "bg-1", status: "running" }));
    });
    expect(result.current.tasks[0]).toMatchObject({ status: "completed", summary: "已完成" });
  });

  it("异会话事件静默丢弃（防切会话后迟到事件串台）", async () => {
    mockedList.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTasks("sess-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.applyEvent(ev({ session_id: "sess-other", task_id: "bg-x" }));
    });
    expect(result.current.tasks).toEqual([]);
  });

  it("sessionId 切换重新拉取，旧会话行不残留", async () => {
    mockedList.mockResolvedValue([row({ task_id: "bg-1" })]);
    const { result, rerender } = renderHook(
      (props: { sessionId: string }) => useSessionTasks(props.sessionId),
      { initialProps: { sessionId: "sess-1" } },
    );
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    mockedList.mockResolvedValue([row({ task_id: "bg-9" })]);
    rerender({ sessionId: "sess-2" });
    await waitFor(() => expect(result.current.tasks[0]!.taskId).toBe("bg-9"));
    expect(mockedList).toHaveBeenLastCalledWith("sess-2");
  });

  it("refreshSignal 递增触发快照重拉（重连对账链路）", async () => {
    mockedList.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      (props: { signal: number }) => useSessionTasks("sess-1", { refreshSignal: props.signal }),
      { initialProps: { signal: 0 } },
    );
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(1));

    mockedList.mockResolvedValue([row({ task_id: "bg-late" })]);
    rerender({ signal: 1 });
    await waitFor(() => expect(result.current.tasks[0]!.taskId).toBe("bg-late"));
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("空快照 [] 正常收敛不报错（FR-07 引擎不上报任务）", async () => {
    mockedList.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTasks("sess-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks).toEqual([]);
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it("竞态失败（404/409/422）静默收敛，不弹错（ql-20260903-014 口径）", async () => {
    for (const status of [404, 409, 422]) {
      mockedList.mockRejectedValueOnce(apiError(status));
      const { result } = renderHook(() => useSessionTasks("sess-1"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.tasks).toEqual([]);
    }
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it("真实失败（网络 / 5xx）notify.error(err, '加载任务清单失败')", async () => {
    const netErr = apiError(0);
    const serverErr = apiError(500);
    mockedList.mockRejectedValueOnce(netErr);
    const first = renderHook(() => useSessionTasks("sess-1"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    mockedList.mockRejectedValueOnce(serverErr);
    const second = renderHook(() => useSessionTasks("sess-1"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(notifyMock.error).toHaveBeenCalledTimes(2);
    expect(notifyMock.error).toHaveBeenNthCalledWith(1, netErr, "加载任务清单失败");
    expect(notifyMock.error).toHaveBeenNthCalledWith(2, serverErr, "加载任务清单失败");
  });
});
