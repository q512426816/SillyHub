/**
 * DistillTaskBar 组件测试（task-08 / 2026-09-17-knowledge-precipitation /
 * FR-01 / FR-03 / D-002@v1）。
 *
 * 依据：
 *   - frontend/src/components/knowledge/distill-task-bar.tsx（对照原型
 *     .distill-bar：spinner + 「蒸馏进行中」标签 + 来源摘要文案）
 *   - task-08 卡片 implementation / acceptance：轮询渲染、进行中行、终态
 *     toast + 刷新回调、失败态含 daemon 离线文案、终态随轮询消失。
 *
 * 惯例（仿 platform-sync-section.test.tsx）：@/lib/knowledge 部分 mock
 * （vi.hoisted + importActual）+ QueryClientProvider retry:false/gcTime:0；
 * useNotify 换纯函数实现（precipitate-dialog.test 同款）。轮询到达用
 * queryClient.refetchQueries 等价驱动；节拍与终态消失用 fake timers +
 * advanceTimersByTimeAsync（platform-sync-section 150s 回显用例同款）。
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISTILL_TERMINAL_LINGER_MS,
  DistillTaskBar,
  distillTasksQueryKey,
} from "@/components/knowledge/distill-task-bar";
import type { DistillTaskRead } from "@/lib/knowledge";

const mocks = vi.hoisted(() => ({ listDistillTasks: vi.fn() }));
vi.mock("@/lib/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge")>()),
  listDistillTasks: mocks.listDistillTasks,
}));

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
// useNotify 依赖 antd App 上下文，这里直接换纯函数实现（precipitate-dialog.test 先例）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notify };
});

const WS = "ws-1";

/** 任务 fixture（字段对齐 task-07 DistillTaskRead 生成类型）。 */
function task(p: Partial<DistillTaskRead> & { agent_run_id: string }): DistillTaskRead {
  return {
    source_type: "session",
    source_ref: "9a8b7c6d-1111-2222-3333-444455556666",
    status: "running",
    created_at: "2026-09-17T10:00:00Z",
    ...p,
  };
}

let queryClient: QueryClient;
/** 本轮用例的任务列表（mock 每次读取快照，切换即模拟下一轮轮询数据）。 */
let tasksHolder: DistillTaskRead[];
const onCompleted = vi.fn();

function renderBar() {
  mocks.listDistillTasks.mockImplementation(() => Promise.resolve([...tasksHolder]));
  return render(
    <QueryClientProvider client={queryClient}>
      <DistillTaskBar workspaceId={WS} onCompleted={onCompleted} />
    </QueryClientProvider>,
  );
}

/** 模拟轮询到点：主动 refetch 任务查询（platform-sync pushMachine 同款）。 */
async function pollTasks() {
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: distillTasksQueryKey(WS) });
  });
}

/** fake timers 下冲刷微任务让查询 settle（platform-sync 用例同款循环）。 */
async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  onCompleted.mockClear();
  tasksHolder = [];
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("DistillTaskBar（task-08）", () => {
  it("进行中任务渲染条：spinner 行 + 状态标签 + 来源摘要，请求带工作区 id", async () => {
    tasksHolder = [
      task({ agent_run_id: "11111111-1111-1111-1111-111111111111" }),
      task({
        agent_run_id: "22222222-2222-2222-2222-222222222222",
        status: "pending",
        source_type: "change",
        source_ref: "2026-09-04-conflict-resolve-entry",
      }),
    ];
    renderBar();

    await waitFor(() =>
      expect(screen.getByTestId("distill-task-bar")).toBeInTheDocument(),
    );
    expect(mocks.listDistillTasks).toHaveBeenCalledWith(WS);
    // pending/running 两行都渲染（排队中 / 蒸馏进行中标签 + 各自来源摘要）。
    expect(screen.getAllByTestId("distill-task-row-active")).toHaveLength(2);
    expect(screen.getByText("蒸馏进行中")).toBeInTheDocument();
    expect(screen.getByText("排队中")).toBeInTheDocument();
    // 会话引用截前 8 位、变更引用原样展示（DistillTaskRead 无标题字段）。
    expect(screen.getByText(/正在从会话记录（9a8b7c6d…）提炼知识/)).toBeInTheDocument();
    expect(
      screen.getByText(/正在从变更归档「2026-09-04-conflict-resolve-entry」提炼知识/),
    ).toBeInTheDocument();
  });

  it("无进行中任务不渲染条：空列表与历史终态任务均返回 null 且不 toast", async () => {
    tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111", status: "completed" })];
    renderBar();

    await waitFor(() => expect(mocks.listDistillTasks).toHaveBeenCalled());
    // 页面首开的历史终态任务从未被观测为进行中 → 不渲染、不补 toast。
    expect(screen.queryByTestId("distill-task-bar")).not.toBeInTheDocument();
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();

    tasksHolder = [];
    await pollTasks();
    expect(screen.queryByTestId("distill-task-bar")).not.toBeInTheDocument();
  });

  it("任务转 completed → 成功 toast + onCompleted 刷新回调 + 终态行短暂展示", async () => {
    tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111" })];
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument(),
    );

    tasksHolder = [
      task({ agent_run_id: "11111111-1111-1111-1111-111111111111", status: "completed" }),
    ];
    await pollTasks();

    // react-query 观察者通知走 setTimeout(0) 宏任务，断言经 waitFor 冲刷后生效。
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith("提炼完成，候选已进入待审核"),
    );
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    // 终态停留行（完成分支文案）。
    expect(screen.getByTestId("distill-task-row-terminal")).toHaveTextContent("提炼完成");
    expect(screen.getByText(/候选知识已进入「待审核」区/)).toBeInTheDocument();

    // 同一任务后续轮询仍是 completed → 不重复 toast / 不重复刷新。
    await pollTasks();
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("任务转 failed → error toast 含 daemon 离线文案 + 失败行，不触发列表刷新", async () => {
    tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111" })];
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument(),
    );

    tasksHolder = [
      task({ agent_run_id: "11111111-1111-1111-1111-111111111111", status: "failed" }),
    ];
    await pollTasks();

    await waitFor(() => expect(notify.error).toHaveBeenCalledTimes(1));
    const errArg = notify.error.mock.calls[0]![0] as Error;
    expect(errArg.message).toContain("daemon 离线");
    // 失败行文案（no_online_daemon 不可区分 → 统一「daemon 离线或执行中断」）。
    expect(screen.getByTestId("distill-task-row-terminal")).toHaveTextContent("提炼失败");
    expect(screen.getByText(/daemon 离线或执行中断/)).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("终态行短暂停留后到期清除，整条不再渲染", async () => {
    vi.useFakeTimers();
    try {
      tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111" })];
      renderBar();
      await flush();
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument();

      // 5s 快档轮询到点 → 收到 failed 终态 → 失败行短暂展示。
      tasksHolder = [
        task({ agent_run_id: "11111111-1111-1111-1111-111111111111", status: "failed" }),
      ];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByTestId("distill-task-row-terminal")).toBeInTheDocument();

      // 推过停留窗（8s）→ 定时清除终态行，整条不再渲染。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DISTILL_TERMINAL_LINGER_MS + 1_000);
      });
      expect(screen.queryByTestId("distill-task-bar")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("轮询节奏：有进行中任务 5s 快档，空闲回退 15s 常规档", async () => {
    vi.useFakeTimers();
    try {
      tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111" })];
      renderBar();
      await flush();
      const initialCalls = mocks.listDistillTasks.mock.calls.length;

      // 进行中：每 5s 一拉。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(mocks.listDistillTasks.mock.calls.length).toBe(initialCalls + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(mocks.listDistillTasks.mock.calls.length).toBe(initialCalls + 2);

      // 数据转空（无进行中任务）→ 回退 15s 常规档：5s 处不拉、15s 处拉一次。
      tasksHolder = [];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const idleCalls = mocks.listDistillTasks.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(mocks.listDistillTasks.mock.calls.length).toBe(idleCalls);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mocks.listDistillTasks.mock.calls.length).toBe(idleCalls + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
