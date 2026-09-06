/**
 * task-10（2026-09-04-session-task-execution-panel）：TaskExecutionPanel 组件级验证
 * （task-07 被测实现 / FR-01~04 / FR-07）。
 *
 * 覆盖（任务卡 implementation 逐条）：
 *   ① 折叠条常驻（FR-01）——空数据 0 计数不报错（FR-07 空态）；点击展开三页签
 *     （任务清单 / 运行中 N / 轮次历史）；
 *   ② 任务清单页签——listSessionTasks 快照渲染紧凑行（任务名 / data-status /
 *     终态定格 pill）+ 计划总纲条（R-07：非空显示 / null 不渲染）；
 *   ③ 折叠摘要计数派生——运行中 N（runningTasks + bash running + 活跃 mission）、
 *     任务 M（成功 X / 失败 Y）由快照行统计；
 *   ④ ref handle applyEvent 注入实时事件 → 任务清单更新（不建第二条 SSE）；
 *   ⑤ 运行中页签——runningTasks / bashProgress / teamMissions props 等值注入
 *     渲染三类卡（AgentTaskCard / BashProgressCard / TeamTaskBlock 复用）；
 *   ⑥ 轮次历史页签——listSessionRuns 紧凑行渲染 + runsRefreshSignal 递增重拉。
 *
 * 测试纪律（对齐 session-usage-bar.test.tsx / agent-task-card-lifecycle.test.tsx）：
 * data-testid / aria-label / 文本锚点断言，不依赖 antd 渲染细节；mock 结构与
 * session-usage-bar 同款（@/lib/daemon 实际模块 + listSessionTasks /
 * listSessionRuns 覆写；stores/session 与 fetch-sse 防 daemon.ts 真实建连噪声）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// fetch-sse 全 mock（daemon.ts import 侧依赖，防真实连接）。
const sseMock = vi.hoisted(() => ({ fetchSse: vi.fn() }));
vi.mock("@/lib/fetch-sse", () => ({ fetchSse: sseMock.fetchSse }));

// zustand session store mock：useSession(selector) 与 useSession.getState() 双形态。
const sessionStoreMock = vi.hoisted(() => ({
  state: {
    accessToken: "test-token" as string | null,
    refreshToken: "refresh-token",
    hydrated: true,
  },
}));
vi.mock("@/stores/session", () => ({
  useSession: Object.assign(
    (sel: (_s: unknown) => unknown) => sel(sessionStoreMock.state),
    { getState: () => sessionStoreMock.state },
  ),
}));

// @/lib/daemon：实际模块 + 两个自取数端点覆写（面板唯二数据源）。
const daemonMock = vi.hoisted(() => ({
  listSessionTasks: vi.fn(),
  listSessionRuns: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listSessionTasks: daemonMock.listSessionTasks,
    listSessionRuns: daemonMock.listSessionRuns,
  };
});

// useNotify 桩（use-session-tasks 错误口径，防依赖 antd / Provider 上下文）。
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { errMessage: actual.errMessage, useNotify: () => notifyMock };
});

import {
  TaskExecutionPanel,
  type TaskExecutionPanelHandle,
} from "@/components/daemon/task-execution-panel";
import type { AgentTaskEntry } from "@/components/daemon/activity-catalog";
import type {
  AgentSessionTaskRead,
  AgentTaskStatusEvent,
  SessionRunRead,
  TeamMissionSummary,
} from "@/lib/daemon";

/* ────────────────────── 共用工具 ────────────────────── */

/** 冲刷 useEffect 取数 promise 链（全 microtask，无需真计时）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {});
  }
}

/** 快照行构造（AgentSessionTaskRead 生成类型全字段）。 */
function taskRow(overrides: Partial<AgentSessionTaskRead> = {}): AgentSessionTaskRead {
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

/** 轮次行构造（SessionRunRead 全字段）。 */
function runRow(overrides: Partial<SessionRunRead> = {}): SessionRunRead {
  return {
    id: "run-a",
    status: "completed",
    error_code: null,
    failure_summary: null,
    error_detail: null,
    started_at: "2026-09-04T09:59:30Z",
    finished_at: "2026-09-04T10:00:28Z",
    exit_code: null,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: 1_200,
    output_tokens: 800,
    user_id: null,
    sender_name: "qinyi",
    ...overrides,
  };
}

/** 实时事件构造（归一化后的 AgentTaskStatusEvent 形状）。 */
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

/** 运行中页签注入的后台任务卡条目。 */
function runningTask(overrides: Partial<AgentTaskEntry> = {}): AgentTaskEntry {
  return {
    taskId: "bg-r1",
    taskName: "跑测试",
    status: "running",
    ...overrides,
  };
}

/** 团队任务概要（活跃 running + 空分身列表最小形态）。 */
function mission(overrides: Partial<TeamMissionSummary> = {}): TeamMissionSummary {
  return {
    mission_id: "m-1",
    status: "running",
    objective: "整理仓库",
    scope_workspace_ids: [],
    budget_usd: null,
    workers: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonMock.listSessionTasks.mockResolvedValue([]);
  daemonMock.listSessionRuns.mockResolvedValue([]);
});

/* ───────── ① 折叠条常驻 + 展开（FR-01 / FR-07 空态） ───────── */

describe("TaskExecutionPanel 折叠条（task-07 / FR-01 / FR-07）", () => {
  it("空数据折叠条常驻显示 0 计数，不报错（FR-07 引擎不上报任务降级）", async () => {
    render(<TaskExecutionPanel sessionId="sess-1" />);
    await flush();
    const summary = screen.getByTestId("task-execution-summary");
    expect(summary.textContent).toContain("运行中 0");
    expect(summary.textContent).toContain("任务 0");
    expect(summary.textContent).toContain("成功 0");
    expect(summary.textContent).toContain("失败 0");
    expect(summary.textContent).toContain("轮次 0");
    // 折叠态：内容区不渲染
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("预会话态（sessionId 空串）两处自取数跳过、计数收敛 0", async () => {
    render(<TaskExecutionPanel sessionId="" />);
    await flush();
    expect(daemonMock.listSessionTasks).not.toHaveBeenCalled();
    expect(daemonMock.listSessionRuns).not.toHaveBeenCalled();
    expect(screen.getByTestId("task-execution-summary").textContent).toContain("任务 0");
  });

  it("点击折叠条展开三页签（任务清单 / 运行中 N / 轮次历史），空数据显示空态文案", async () => {
    render(<TaskExecutionPanel sessionId="sess-1" />);
    await flush();
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    // 三页签按钮（任务清单 / 运行中 0 / 轮次历史）
    expect(screen.getByTestId("task-execution-tab-tasks").textContent).toBe("任务清单");
    expect(screen.getByTestId("task-execution-tab-running").textContent).toBe("运行中 0");
    expect(screen.getByTestId("task-execution-tab-runs").textContent).toBe("轮次历史");
    // 默认任务清单页签空态文案（FR-07：不报错、不阻塞）
    expect(screen.getByTestId("task-execution-empty").textContent).toContain(
      "暂无任务记录",
    );
    // 运行中页签空态
    fireEvent.click(screen.getByTestId("task-execution-tab-running"));
    expect(screen.getByTestId("task-execution-empty").textContent).toBe("当前无运行中任务");
    // 轮次页签空态
    fireEvent.click(screen.getByTestId("task-execution-tab-runs"));
    await flush(); // 惰性取数（task-10）：首次进入轮次页签才拉快照
    expect(screen.getByTestId("task-execution-empty").textContent).toBe("暂无轮次记录");
    // 再点击折叠条收起：内容区移除
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

/* ───────── ② 任务清单页签：快照行 + 计划总纲（R-07 降级） ───────── */

describe("TaskExecutionPanel 任务清单页签（task-07 / FR-02）", () => {
  it("快照渲染紧凑任务行：任务名 / data-status / 终态定格 pill", async () => {
    daemonMock.listSessionTasks.mockResolvedValue([
      taskRow({ task_id: "bg-1", task_name: "后台调研", status: "completed", summary: "调研完成" }),
      taskRow({ task_id: "bg-2", task_name: "跑回归", status: "failed" }),
    ]);
    render(<TaskExecutionPanel sessionId="sess-1" />);
    await flush();
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    const rows = screen.getAllByTestId("task-execution-task-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-status", "completed");
    expect(rows[0]!.textContent).toContain("后台调研");
    expect(rows[0]!.textContent).toContain("已完成"); // 终态定格 pill 文案
    expect(rows[1]).toHaveAttribute("data-status", "failed");
    expect(rows[1]!.textContent).toContain("失败");
  });

  it("planObjective 非空显示总纲条（含步骤计数）；null 不渲染（R-07 降级形态）", async () => {
    const { rerender } = render(
      <TaskExecutionPanel sessionId="sess-1" planObjective="梳理任务面板测试" planTasks={["a", "b", "c"]} />,
    );
    await flush();
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    const plan = screen.getByTestId("task-execution-plan");
    expect(plan.textContent).toContain("梳理任务面板测试");
    expect(plan.textContent).toContain("3 个步骤");
    // R-07：刷新 / 重连后挂载方不再注入 → 总纲不显示、不报错
    rerender(<TaskExecutionPanel sessionId="sess-1" planObjective={null} />);
    expect(screen.queryByTestId("task-execution-plan")).toBeNull();
  });
});

/* ───────── ③ 折叠摘要计数派生 ───────── */

describe("TaskExecutionPanel 折叠摘要计数（task-07 / FR-01）", () => {
  it("运行中 N = runningTasks + bash running + 活跃 mission；任务 M（成功 X / 失败 Y）由快照统计", async () => {
    daemonMock.listSessionTasks.mockResolvedValue([
      taskRow({ task_id: "bg-1", status: "completed" }),
      taskRow({ task_id: "bg-2", status: "failed" }),
      taskRow({ task_id: "bg-3", status: "running" }),
    ]);
    render(
      <TaskExecutionPanel
        sessionId="sess-1"
        runningTasks={[runningTask()]}
        bashProgress={{
          command: "pnpm vitest run",
          status: "running",
          exitCode: null,
          elapsedMs: 1_000,
          chunks: [],
        }}
        teamMissions={[
          mission({ mission_id: "m-1", status: "running" }),
          mission({ mission_id: "m-2", status: "done" }), // 终态不计入运行中
        ]}
      />,
    );
    await flush();
    const summary = screen.getByTestId("task-execution-summary");
    // 运行中 = 1 任务卡 + 1 bash + 1 活跃 mission = 3（终态 mission 不计）
    expect(summary.textContent).toContain("运行中 3");
    // 任务 3（成功 1 / 失败 1）（running 行不计入成功/失败）
    expect(summary.textContent).toContain("任务 3");
    expect(summary.textContent).toContain("成功 1");
    expect(summary.textContent).toContain("失败 1");
  });

  it("轮次计数随 listSessionRuns 快照派生", async () => {
    daemonMock.listSessionRuns.mockResolvedValue([runRow(), runRow({ id: "run-b" })]);
    render(<TaskExecutionPanel sessionId="sess-1" />);
    // 惰性取数（task-10）：轮次计数在轮次页签首次查看后才从快照派生
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    fireEvent.click(screen.getByTestId("task-execution-tab-runs"));
    await waitFor(() =>
      expect(screen.getByTestId("task-execution-summary").textContent).toContain("轮次 2"),
    );
  });
});

/* ───────── ④ ref handle applyEvent 实时注入 ───────── */

describe("TaskExecutionPanel applyEvent 注入（task-07 / D-001@v1）", () => {
  it("经 ref.handle.applyEvent 注入实时事件 → 清单新建行 + 摘要计数更新；异会话事件丢弃", async () => {
    const handle: { current: TaskExecutionPanelHandle | null } = { current: null };
    daemonMock.listSessionTasks.mockResolvedValue([
      taskRow({ task_id: "bg-1", status: "completed" }),
    ]);
    render(<TaskExecutionPanel ref={handle} sessionId="sess-1" />);
    await flush();
    expect(handle.current).not.toBeNull();
    // 异会话事件静默丢弃（防切会话串台）
    act(() => {
      handle.current!.applyEvent(ev({ session_id: "sess-other", task_id: "bg-x" }));
    });
    expect(screen.getByTestId("task-execution-summary").textContent).toContain("任务 1");
    // 本会话首见 running 事件 → 新行插队首
    act(() => {
      handle.current!.applyEvent(ev({ task_id: "bg-live", task_name: "实时任务" }));
    });
    expect(screen.getByTestId("task-execution-summary").textContent).toContain("任务 2");
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    const rows = screen.getAllByTestId("task-execution-task-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-status", "running");
    expect(rows[0]!.textContent).toContain("实时任务");
    // 终态事件 → 行状态定格
    act(() => {
      handle.current!.applyEvent(ev({ task_id: "bg-live", status: "completed" }));
    });
    expect(screen.getAllByTestId("task-execution-task-row")[0]).toHaveAttribute(
      "data-status",
      "completed",
    );
  });
});

/* ───────── ⑤ 运行中页签：三类卡注入 ───────── */

describe("TaskExecutionPanel 运行中页签（task-07 / FR-03）", () => {
  it("runningTasks / bashProgress / teamMissions 注入渲染三类卡容器", async () => {
    render(
      <TaskExecutionPanel
        sessionId="sess-1"
        runningTasks={[runningTask({ taskId: "bg-r1", taskName: "跑测试" })]}
        bashProgress={{
          command: "pnpm lint",
          status: "running",
          exitCode: null,
          elapsedMs: 2_000,
          chunks: [{ channel: "stdout", content: "ok", is_final: false }],
        }}
        teamMissions={[mission({ mission_id: "m-1", objective: "整理仓库" })]}
      />,
    );
    await flush();
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    fireEvent.click(screen.getByTestId("task-execution-tab-running"));
    // 三类卡复用渲染（各子组件既有 testid / aria-label 锚点，粗断言容器存在）
    expect(screen.getByLabelText("bash 命令进度")).toBeInTheDocument();
    expect(screen.getByLabelText("后台任务列表")).toBeInTheDocument();
    expect(screen.getByLabelText("会话团队任务列表")).toBeInTheDocument();
    expect(screen.getByTestId("agent-task-card")).toHaveAttribute("data-status", "running");
  });
});

/* ───────── ⑥ 轮次历史页签 + runsRefreshSignal ───────── */

describe("TaskExecutionPanel 轮次历史页签（task-07 / FR-04）", () => {
  it("listSessionRuns 快照渲染紧凑轮次行（轮次号 / 状态 / 发送者）", async () => {
    daemonMock.listSessionRuns.mockResolvedValue([
      runRow({ id: "run-a", status: "completed", sender_name: "qinyi" }),
      runRow({ id: "run-b", status: "running", sender_name: null }),
    ]);
    render(<TaskExecutionPanel sessionId="sess-1" />);
    await flush();
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    fireEvent.click(screen.getByTestId("task-execution-tab-runs"));
    await flush(); // 惰性取数（task-10）：首次进入才拉
    const rows = screen.getAllByTestId("task-execution-run-row");
    expect(rows).toHaveLength(2);
    // 服务端倒序（队首最新）→ 序号 = 总数 - 下标：#2 / #1
    expect(rows[0]!.textContent).toContain("#2");
    expect(rows[0]!.textContent).toContain("成功");
    expect(rows[0]!.textContent).toContain("qinyi");
    expect(rows[1]!.textContent).toContain("#1");
    expect(rows[1]!.textContent).toContain("运行中");
  });

  it("runsRefreshSignal 递增触发 listSessionRuns 重拉", async () => {
    const { rerender } = render(<TaskExecutionPanel sessionId="sess-1" />);
    // 惰性取数（task-10）：先激活轮次页签建立取数闸门
    fireEvent.click(screen.getByTestId("task-execution-bar"));
    fireEvent.click(screen.getByTestId("task-execution-tab-runs"));
    await waitFor(() => expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(1));
    rerender(<TaskExecutionPanel sessionId="sess-1" runsRefreshSignal={1} />);
    await waitFor(() => expect(daemonMock.listSessionRuns).toHaveBeenCalledTimes(2));
    expect(daemonMock.listSessionRuns).toHaveBeenLastCalledWith("sess-1");
  });

  it("tasksRefreshSignal 递增透传 useSessionTasks 触发快照重拉", async () => {
    const { rerender } = render(<TaskExecutionPanel sessionId="sess-1" />);
    await waitFor(() => expect(daemonMock.listSessionTasks).toHaveBeenCalledTimes(1));
    rerender(<TaskExecutionPanel sessionId="sess-1" tasksRefreshSignal={1} />);
    await waitFor(() => expect(daemonMock.listSessionTasks).toHaveBeenCalledTimes(2));
  });
});
