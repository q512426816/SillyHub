/**
 * verify P2 返工（2026-08-24-platform-session-feedback-fix / task-12）：
 * session SSE 四类新事件（plan_mode_entered / bash_status / bash_chunk /
 * agent_task_status）的 streamSession 分发测试。
 *
 * mock 体系与 daemon-session.test.ts 同款：fetch + ReadableStream 假 SSE 流，
 * 写 backend 真实输出形态的默认 data 帧（无 event: 行，与 /sessions/{id}/stream
 * 一致——真环境验证见 change verify-result.md Runtime Evidence），断言 handlers
 * 收到归一化后的事件对象。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  streamSession,
  type SessionStreamHandlers,
} from "@/lib/daemon";

interface FakeSseStream {
  url: string;
  push: (text: string) => void;
}

let lastStream: FakeSseStream | null = null;

function installSseFetchMock(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, _init?: RequestInit) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const encoder = new TextEncoder();
      const stream: FakeSseStream = {
        url: typeof input === "string" ? input : input.toString(),
        push: (text) => controller.enqueue(encoder.encode(text)),
      };
      lastStream = stream;
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    },
  );
}

function emitDefault(stream: FakeSseStream, data: unknown) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  stream.push(`data: ${payload}\n\n`);
}

async function flushSse(times = 3) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("streamSession — 会话反馈四事件分发（task-12 verify P2 返工）", () => {
  beforeEach(() => {
    installSseFetchMock();
    lastStream = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plan_mode_entered 帧 → onPlanModeEntered 收到归一化 summary", async () => {
    const onPlanModeEntered = vi.fn();
    streamSession("sess-1", { onPlanModeEntered } as SessionStreamHandlers);
    await flushSse();
    emitDefault(lastStream!, {
      event: "plan_mode_entered",
      session_id: "sess-1",
      run_id: "run-1",
      summary: { objective: "目标A", tasks: ["t1", "t2"], design_snippet: "§3" },
      requested_at: "2026-08-24T16:00:00Z",
    });
    await flushSse();

    expect(onPlanModeEntered).toHaveBeenCalledTimes(1);
    expect(onPlanModeEntered).toHaveBeenCalledWith({
      event: "plan_mode_entered",
      session_id: "sess-1",
      run_id: "run-1",
      summary: { objective: "目标A", tasks: ["t1", "t2"], design_snippet: "§3" },
      requested_at: "2026-08-24T16:00:00Z",
    });
  });

  it("bash_status 帧 → onBashStatus 收到 status/exit_code/elapsed_ms", async () => {
    const onBashStatus = vi.fn();
    streamSession("sess-1", { onBashStatus } as SessionStreamHandlers);
    await flushSse();
    emitDefault(lastStream!, {
      event: "bash_status",
      session_id: "sess-1",
      run_id: "run-1",
      command: "pnpm test",
      status: "completed",
      exit_code: 0,
      elapsed_ms: 2043,
    });
    await flushSse();

    expect(onBashStatus).toHaveBeenCalledWith({
      event: "bash_status",
      session_id: "sess-1",
      run_id: "run-1",
      command: "pnpm test",
      status: "completed",
      exit_code: 0,
      elapsed_ms: 2043,
    });
  });

  it("bash_chunk 帧 → onBashChunk 收到 channel/content/is_final", async () => {
    const onBashChunk = vi.fn();
    streamSession("sess-1", { onBashChunk } as SessionStreamHandlers);
    await flushSse();
    emitDefault(lastStream!, {
      event: "bash_chunk",
      session_id: "sess-1",
      run_id: "run-1",
      command: "pnpm test",
      channel: "stderr",
      content: "warn-line",
      is_final: true,
    });
    await flushSse();

    expect(onBashChunk).toHaveBeenCalledWith({
      event: "bash_chunk",
      session_id: "sess-1",
      run_id: "run-1",
      command: "pnpm test",
      channel: "stderr",
      content: "warn-line",
      is_final: true,
    });
  });

  it("agent_task_status 帧 → onAgentTaskStatus 收到 task_id/status/progress/message", async () => {
    const onAgentTaskStatus = vi.fn();
    streamSession("sess-1", { onAgentTaskStatus } as SessionStreamHandlers);
    await flushSse();
    emitDefault(lastStream!, {
      event: "agent_task_status",
      session_id: "sess-1",
      run_id: "run-1",
      task_id: "task-99",
      task_name: "Design Grill",
      status: "running",
      progress: 50,
      message: "审查中",
    });
    await flushSse();

    expect(onAgentTaskStatus).toHaveBeenCalledTimes(1);
    expect(onAgentTaskStatus).toHaveBeenCalledWith({
      event: "agent_task_status",
      session_id: "sess-1",
      run_id: "run-1",
      task_id: "task-99",
      task_name: "Design Grill",
      status: "running",
      progress: 50,
      message: "审查中",
    });
  });

  it("agent_task_status 字段缺失/非法 → 兜底不抛错（progress→null、status→running）", async () => {
    const onAgentTaskStatus = vi.fn();
    streamSession("sess-1", { onAgentTaskStatus } as SessionStreamHandlers);
    await flushSse();
    emitDefault(lastStream!, {
      event: "agent_task_status",
      session_id: "sess-1",
      run_id: "run-1",
    });
    await flushSse();

    expect(onAgentTaskStatus).toHaveBeenCalledWith({
      event: "agent_task_status",
      session_id: "sess-1",
      run_id: "run-1",
      task_id: "",
      task_name: "",
      status: "running",
      progress: null,
      message: null,
    });
  });

  it("未知 event 类型 → 静默忽略不抛错、无 handler 触发（向后兼容守卫）", async () => {
    const handlers: SessionStreamHandlers = {
      onPlanModeEntered: vi.fn(),
      onBashStatus: vi.fn(),
      onBashChunk: vi.fn(),
      onAgentTaskStatus: vi.fn(),
    };
    streamSession("sess-1", handlers);
    await flushSse();
    expect(() => {
      emitDefault(lastStream!, { event: "future_unknown_kind", session_id: "sess-1" });
    }).not.toThrow();
    await flushSse();

    expect(handlers.onPlanModeEntered).not.toHaveBeenCalled();
    expect(handlers.onBashStatus).not.toHaveBeenCalled();
    expect(handlers.onBashChunk).not.toHaveBeenCalled();
    expect(handlers.onAgentTaskStatus).not.toHaveBeenCalled();
  });
});
