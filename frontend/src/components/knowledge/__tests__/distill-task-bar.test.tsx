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

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// D-010④ 跳转：任务行「查看会话 ↗」经 router.push 深链（jsdom 无 App Router，
// mock next/navigation）。
const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
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

/** 任务 fixture（字段对齐 task-07 DistillTaskRead 生成类型；mode 为 D-009 必填投影）。 */
function task(p: Partial<DistillTaskRead> & { agent_run_id: string }): DistillTaskRead {
  return {
    source_type: "session",
    source_ref: "9a8b7c6d-1111-2222-3333-444455556666",
    status: "running",
    created_at: "2026-09-17T10:00:00Z",
    mode: "fresh",
    ...p,
  };
}

let queryClient: QueryClient;
/** 本轮用例的任务列表（mock 每次读取快照，切换即模拟下一轮轮询数据）。 */
let tasksHolder: DistillTaskRead[];
const onCompleted = vi.fn();
const onJumpToEntry = vi.fn();

function renderBar(options: { onJumpToEntry?: (filename: string) => void } = {}) {
  mocks.listDistillTasks.mockImplementation(() => Promise.resolve([...tasksHolder]));
  return render(
    <QueryClientProvider client={queryClient}>
      <DistillTaskBar
        workspaceId={WS}
        onCompleted={onCompleted}
        onJumpToEntry={options.onJumpToEntry ?? onJumpToEntry}
      />
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
  onJumpToEntry.mockClear();
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

describe("DistillTaskBar · D-009 降级提示 + D-010 merged_to 反链（task-08 扩展）", () => {
  it("进行中任务带 degraded_reason（resume 被降级 fresh）→ 行内展示「已降级」提示", async () => {
    tasksHolder = [
      task({
        agent_run_id: "11111111-1111-1111-1111-111111111111",
        degraded_reason: "provider_no_resume",
      }),
    ];
    renderBar();

    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument(),
    );
    const degrade = screen.getByTestId("distill-row-degraded");
    expect(degrade).toHaveTextContent("已降级：引擎不支持续接");
    expect(degrade).toHaveTextContent("已改为新建 agent");
  });

  it("completed 且 merged_to 非空 → 终态行「已合并到 <文件#小节>」可点击，点击跳文件段", async () => {
    tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111" })];
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument(),
    );

    tasksHolder = [
      task({
        agent_run_id: "11111111-1111-1111-1111-111111111111",
        status: "completed",
        merged_to: "known-issues.md#Windows 控制台码页导致日志乱码",
      }),
    ];
    await pollTasks();

    const link = await screen.findByTestId("distill-merged-link");
    expect(link).toHaveTextContent("已合并到 known-issues.md#Windows 控制台码页导致日志乱码");
    fireEvent.click(link);
    // merged_to 双键取文件段反链（防锚点漂移，D-010①）。
    expect(onJumpToEntry).toHaveBeenCalledWith("known-issues.md");
  });

  it("completed 且无 merged_to → 终态行展示待审核文案，无反链按钮", async () => {
    tasksHolder = [task({ agent_run_id: "11111111-1111-1111-1111-111111111111" })];
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument(),
    );

    tasksHolder = [
      task({ agent_run_id: "11111111-1111-1111-1111-111111111111", status: "completed" }),
    ];
    await pollTasks();

    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-terminal")).toBeInTheDocument(),
    );
    expect(screen.getByText(/候选知识已进入「待审核」区/)).toBeInTheDocument();
    expect(screen.queryByTestId("distill-merged-link")).not.toBeInTheDocument();
  });

  it("quick 多选任务来源摘要按条数展示（source_ref list 投影）", async () => {
    tasksHolder = [
      task({
        agent_run_id: "11111111-1111-1111-1111-111111111111",
        source_type: "quick",
        source_ref: JSON.stringify(["ql-20260917-001-a1b2", "ql-20260917-002-c3d4"]),
      }),
    ];
    renderBar();

    await waitFor(() =>
      expect(screen.getByText(/正在从 2 条快速修复记录提炼知识/)).toBeInTheDocument(),
    );
  });

  it("splitMergedTo / distillDegradedText 纯函数：双键拆分与未知降级原因兜底", async () => {
    const { splitMergedTo, distillDegradedText } = await import(
      "@/components/knowledge/distill-task-bar"
    );
    expect(splitMergedTo("known-issues.md#Windows 码页")).toEqual({
      file: "known-issues.md",
      section: "Windows 码页",
    });
    expect(splitMergedTo("decisions/daemon.md")).toEqual({
      file: "decisions/daemon.md",
      section: null,
    });
    expect(distillDegradedText("provider_no_resume")).toContain("引擎不支持续接");
    expect(distillDegradedText("some_future_reason")).toBe("已降级：some_future_reason");
  });

  it("D-010④ 查看会话跳转：agent_session_id 非空渲染按钮，点击 router.push 深链 /sessions?session=<id>", async () => {
    tasksHolder = [task({ agent_run_id: "r-1", agent_session_id: "sess-distill-1", status: "running" })];
    renderBar();
    const btn = await screen.findByTestId("distill-session-link");
    expect(btn).toHaveTextContent("查看会话");
    fireEvent.click(btn);
    expect(pushMock).toHaveBeenCalledWith("/sessions?session=sess-distill-1");
  });

  it("D-010④ 无 agent_session_id 不渲染查看会话按钮（零回归）", async () => {
    tasksHolder = [task({ agent_run_id: "r-2", status: "running" })];
    renderBar();
    await screen.findByText(/蒸馏进行中/);
    expect(screen.queryByTestId("distill-session-link")).not.toBeInTheDocument();
  });

  it("D-010④ 失败终态行同样带查看会话入口", async () => {
    // 终态行依赖「进行中 → 终态」转移观测（直 mock 终态不渲染，task-08 结构）。
    tasksHolder = [task({ agent_run_id: "r-3", agent_session_id: "sess-distill-3" })];
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-active")).toBeInTheDocument(),
    );
    tasksHolder = [
      task({ agent_run_id: "r-3", agent_session_id: "sess-distill-3", status: "failed" }),
    ];
    await pollTasks();
    await waitFor(() =>
      expect(screen.getByTestId("distill-task-row-terminal")).toHaveTextContent("提炼失败"),
    );
    const btn = screen.getByTestId("distill-session-link");
    fireEvent.click(btn);
    expect(pushMock).toHaveBeenCalledWith("/sessions?session=sess-distill-3");
  });
});
