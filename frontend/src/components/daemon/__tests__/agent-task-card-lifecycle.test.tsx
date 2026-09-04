/**
 * task-15（2026-08-27-background-subagent-progress / FR-06）：
 * 后台 Agent 任务卡片全生命周期单测（task-12 被测实现）。
 *
 * 覆盖（task 卡 implementation 逐条）：
 *   1. running 态「正在做什么」行——无扩展字段退化文案「后台任务运行中」；
 *      带 last_tool_name / summary 显示工具 chip + 摘要；
 *   2. 走秒锚点校准（FR-06）——服务端 elapsed_ms + elapsedSyncedAt 锚点本地
 *      增量走秒（fake timers 推进）；无 elapsedSyncedAt 回退 startedAt 兜底
 *      走秒；无任何锚点不显示计时（不伪造）；
 *   3. 终态定格——completed / failed / stopped：data-status + 状态文案 +
 *      「真实用时 mm:ss」（服务端 elapsed_ms 权威；缺失回退 startedAt→terminalAt
 *      本地区间；再缺失不显示）+ summary 首行；终态不再转圈（无进行中徽标、
 *      无 doing 行、无 idle 警示）；
 *   4. 「最后活跃」警示（>AGENT_TASK_IDLE_WARN_MS 无心跳切换橙色行，分钟数
 *      文案；恰好达门槛不切换——严格大于）；
 *   5. usage 行（tokens / 工具次数，formatTokens 格式）；
 *   6. applyAgentTaskStatusEvent 归约（session-panel 导出，page / dialog 共用）
 *      ——首见 running 建条（锚点初始化）、心跳推进锚点 + 字段只增不减、终态
 *      定格（terminalAt + 服务端时长）、**终态为吸收态**（迟到 running 心跳不
 *      复活转圈，原引用返回）、后到终态允许覆盖定格数据、最近 6 条截断。
 *
 * 测试纪律（对齐 agent-task-card.test.tsx / session-panel-bash-progress.test.ts）：
 * 组件不依赖 antd（data-testid 断言，无 autoLetterSpacing/getByRole 拆字坑）；
 * fake timers 用 try/finally 包裹恢复真实时钟（对齐 turn-segment-views 惯例）。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

import {
  AgentTaskCard,
  AGENT_TASK_IDLE_WARN_MS,
} from "@/components/daemon/agent-task-card";
import { applyAgentTaskStatusEvent } from "@/components/daemon/session-panel";
import type { AgentTaskEntry } from "@/components/daemon/activity-catalog";
import type { AgentTaskStatusEvent } from "@/lib/daemon";

/* ───────── 组件：running 态「正在做什么」行 ───────── */

describe("AgentTaskCard 生命周期（task-12 / FR-06）—— running「正在做什么」", () => {
  it("running 无扩展字段（旧 daemon 事件）→ doing 行退化文案「后台任务运行中」", () => {
    render(<AgentTaskCard taskId="t-1" taskName="后台调研" status="running" />);
    const card = screen.getByTestId("agent-task-card");
    expect(card).toHaveAttribute("data-status", "running");
    // FR-06：事件字段缺失退化为现状文案，不渲染空 chip / 空摘要
    expect(screen.getByTestId("agent-task-doing").textContent).toBe("后台任务运行中");
    // 无 elapsedMs / 锚点 → 不显示计时（不伪造时长）
    expect(card.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("running 带 last_tool_name + summary → doing 行显示工具 chip 与摘要", () => {
    render(
      <AgentTaskCard
        taskId="t-2"
        taskName="跑回归"
        status="running"
        lastToolName="Bash"
        summary="正在跑 pnpm vitest run"
      />,
    );
    const doing = screen.getByTestId("agent-task-doing");
    expect(doing.textContent).toContain("Bash");
    expect(doing.textContent).toContain("正在跑 pnpm vitest run");
  });

  it("usage 行：totalTokens / toolUses 累积文案（formatTokens k 格式）", () => {
    const { rerender } = render(
      <AgentTaskCard taskId="t-3" taskName="用量任务" status="running" totalTokens={12_345} toolUses={3} />,
    );
    expect(screen.getByTestId("agent-task-usage").textContent).toBe(
      "tokens 12.3K · 工具 3 次",
    );
    // 未携带用量字段 → usage 行不渲染（不显示空行）
    rerender(<AgentTaskCard taskId="t-3" taskName="无用量" status="running" />);
    expect(screen.queryByTestId("agent-task-usage")).toBeNull();
    rerender(
      <AgentTaskCard taskId="t-3" taskName="仅 tokens" status="running" totalTokens={800} />,
    );
    expect(screen.getByTestId("agent-task-usage").textContent).toBe("tokens 800");
  });
});

/* ───────── 组件：走秒锚点校准（fake timers） ───────── */

describe("AgentTaskCard 走秒锚点校准（FR-06）", () => {
  it("服务端 elapsed_ms + elapsedSyncedAt 锚点 → 本地增量走秒（推进 5s 秒数 +5）", () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      render(
        <AgentTaskCard
          taskId="t-4"
          taskName="走秒任务"
          status="running"
          elapsedMs={65_000}
          elapsedSyncedAt={t0}
        />,
      );
      // 65s + 0 增量 → 01:05
      expect(screen.getByText("01:05")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      // 65s + 5s 本地增量 → 01:10（校准锚点后继续走，不重置）
      expect(screen.getByText("01:10")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("无 elapsedSyncedAt 回退 startedAt 兜底走秒（elapsed 基数为 0）", () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      render(
        <AgentTaskCard
          taskId="t-5"
          taskName="兜底走秒"
          status="running"
          startedAt={t0 - 42_000}
        />,
      );
      expect(screen.getByText("00:42")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(18_000);
      });
      expect(screen.getByText("01:00")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ───────── 组件：终态定格 ───────── */

describe("AgentTaskCard 终态定格（task-12 / FR-06）", () => {
  it("completed：状态图标定格 +「真实用时 mm:ss」（服务端 elapsed_ms）+ summary 首行；不再转圈", () => {
    render(
      <AgentTaskCard
        taskId="t-6"
        taskName="调研收尾"
        status="completed"
        elapsedMs={83_000}
        summary={"全部通过，共 42 个用例\n\n细节见测试报告"}
      />,
    );
    const card = screen.getByTestId("agent-task-card");
    expect(card).toHaveAttribute("data-status", "completed");
    expect(screen.getByText(/已完成/)).toBeInTheDocument();
    // 终态用时前缀「真实用时」（区别于 running 走秒）
    expect(card.textContent).toContain("真实用时 01:23");
    // 多行 summary 只取首个非空行（FR-06 截断展示）
    expect(screen.getByTestId("agent-task-summary").textContent).toBe(
      "全部通过，共 42 个用例",
    );
    // 定格：无进行中徽标 / 无 doing 行 / 无 idle 警示
    expect(screen.queryByText("后台任务进行中")).toBeNull();
    expect(screen.queryByTestId("agent-task-doing")).toBeNull();
    expect(screen.queryByTestId("agent-task-idle-warn")).toBeNull();
  });

  it("failed / stopped 终态：data-status 与状态文案各自正确", () => {
    const { rerender } = render(
      <AgentTaskCard taskId="t-7" taskName="崩溃场景" status="failed" elapsedMs={9_500} />,
    );
    expect(screen.getByTestId("agent-task-card")).toHaveAttribute("data-status", "failed");
    expect(screen.getByText(/失败/)).toBeInTheDocument();
    expect(screen.getByTestId("agent-task-card").textContent).toContain("真实用时 00:09");
    rerender(
      <AgentTaskCard taskId="t-7" taskName="停止任务" status="stopped" elapsedMs={120_000} />,
    );
    expect(screen.getByTestId("agent-task-card")).toHaveAttribute("data-status", "stopped");
    expect(screen.getByText(/已停止/)).toBeInTheDocument();
    expect(screen.getByTestId("agent-task-card").textContent).toContain("真实用时 02:00");
  });

  it("终态无服务端 elapsed_ms → 回退 startedAt→terminalAt 本地区间；再缺失不显示时长", () => {
    const { rerender } = render(
      <AgentTaskCard
        taskId="t-8"
        taskName="本地兜底"
        status="completed"
        startedAt={1_000}
        terminalAt={154_000}
      />,
    );
    expect(screen.getByTestId("agent-task-card").textContent).toContain("真实用时 02:33");
    // 无服务端时长也无本地区间 → 不伪造（无 mm:ss、无「真实用时」前缀）
    rerender(<AgentTaskCard taskId="t-8" taskName="无锚点" status="completed" />);
    const card = screen.getByTestId("agent-task-card");
    expect(card.textContent).not.toContain("真实用时");
    expect(card.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("终态无 summary → summary 行不渲染（不留空行）", () => {
    render(<AgentTaskCard taskId="t-9" taskName="无摘要" status="completed" elapsedMs={1} />);
    expect(screen.queryByTestId("agent-task-summary")).toBeNull();
  });
});

/* ───────── 组件：「最后活跃」警示（fake timers 推进门槛） ───────── */

describe("AgentTaskCard 最后活跃警示（task-12 / FR-06）", () => {
  it("running 距最近心跳超过 AGENT_TASK_IDLE_WARN_MS → 橙色警示行替换 doing 行（分钟数）", () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      render(
        <AgentTaskCard
          taskId="t-10"
          taskName="沉默任务"
          status="running"
          lastToolName="Bash"
          summary="长命令执行中"
          startedAt={t0 - 6 * 60_000}
          lastActivityAt={t0}
        />,
      );
      // 门槛内：doing 行正常（工具 chip + 摘要）
      expect(screen.getByTestId("agent-task-doing").textContent).toContain("长命令执行中");
      expect(screen.queryByTestId("agent-task-idle-warn")).toBeNull();
      // 恰好达门槛（严格大于判定）：仍不切换
      act(() => {
        vi.advanceTimersByTime(AGENT_TASK_IDLE_WARN_MS);
      });
      expect(screen.queryByTestId("agent-task-idle-warn")).toBeNull();
      // 超过门槛 1s → 警示行出现，doing 行被替换
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      const warn = screen.getByTestId("agent-task-idle-warn");
      expect(warn.textContent).toContain("最后活跃 5 分钟前");
      expect(screen.queryByTestId("agent-task-doing")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("终态不参与沉默判定：lastActivityAt 再旧也不显示 idle 警示（已定格）", () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      render(
        <AgentTaskCard
          taskId="t-11"
          taskName="已定格任务"
          status="completed"
          elapsedMs={1_000}
          lastActivityAt={t0 - 30 * 60_000}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.queryByTestId("agent-task-idle-warn")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ───────── 归约：applyAgentTaskStatusEvent（session-panel 导出） ───────── */

describe("applyAgentTaskStatusEvent 归约（task-12 / FR-06）", () => {
  /** 构造归一化后的 agent_task_status 事件（lib/daemon 形状）。 */
  function ev(overrides: Partial<AgentTaskStatusEvent>): AgentTaskStatusEvent {
    return {
      event: "agent_task_status",
      session_id: "s-1",
      run_id: "run-1",
      task_id: "bg-1",
      task_name: "后台调研",
      status: "running",
      progress: null,
      message: null,
      ...overrides,
    };
  }

  it("首见 running 事件 → 建条：startedAt / lastActivityAt 锚点初始化，扩展字段缺省为 null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));
    try {
      const [entry] = applyAgentTaskStatusEvent([], ev({}));
      expect(entry).toMatchObject({
        taskId: "bg-1",
        taskName: "后台调研",
        status: "running",
        lastToolName: null,
        summary: null,
        elapsedMs: null,
        elapsedSyncedAt: null,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        terminalAt: null,
        totalTokens: null,
        toolUses: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("running 心跳：推进 lastActivityAt / elapsedSyncedAt，扩展字段只增不减（缺字段不回退）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));
    try {
      let list = applyAgentTaskStatusEvent([], ev({}));
      const first = list[0] as AgentTaskEntry;
      vi.setSystemTime(new Date("2026-08-27T10:00:04Z"));
      // 心跳带 last_tool_name / summary / tokens，但缺 elapsed_ms
      list = applyAgentTaskStatusEvent(
        list,
        ev({ last_tool_name: "Bash", summary: "跑测试中", total_tokens: 12_345, tool_uses: 2 }),
      );
      const second = list[0] as AgentTaskEntry;
      expect(second.lastToolName).toBe("Bash");
      expect(second.summary).toBe("跑测试中");
      expect(second.totalTokens).toBe(12_345);
      expect(second.toolUses).toBe(2);
      // 缺 elapsed_ms → elapsedMs 沿用旧值 null，锚点不重置；startedAt 首见锚点不动
      expect(second.elapsedMs).toBeNull();
      expect(second.elapsedSyncedAt).toBeNull();
      expect(second.startedAt).toBe(first.startedAt);
      expect(second.lastActivityAt).toBe(Date.now());
      // 再来一条缺 summary 的心跳 → 旧 summary 保留（只增不减）
      vi.setSystemTime(new Date("2026-08-27T10:00:08Z"));
      list = applyAgentTaskStatusEvent(list, ev({ elapsed_ms: 65_000 }));
      const third = list[0] as AgentTaskEntry;
      expect(third.summary).toBe("跑测试中");
      expect(third.elapsedMs).toBe(65_000);
      expect(third.elapsedSyncedAt).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  it("终态事件：定格（terminalAt + 服务端 elapsed），lastActivityAt 不再推进", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));
    try {
      let list = applyAgentTaskStatusEvent([], ev({}));
      vi.setSystemTime(new Date("2026-08-27T10:00:30Z"));
      list = applyAgentTaskStatusEvent(list, ev({}));
      const running = list[0] as AgentTaskEntry;
      vi.setSystemTime(new Date("2026-08-27T10:05:00Z"));
      list = applyAgentTaskStatusEvent(
        list,
        ev({ status: "completed", elapsed_ms: 300_000, summary: "全部完成" }),
      );
      const done = list[0] as AgentTaskEntry;
      expect(done.status).toBe("completed");
      expect(done.terminalAt).toBe(Date.now());
      expect(done.elapsedMs).toBe(300_000);
      // 终态不推进「最后活跃」锚点（定格后卡片不再判沉默）
      expect(done.lastActivityAt).toBe(running.lastActivityAt);
      expect(done.summary).toBe("全部完成");
    } finally {
      vi.useRealTimers();
    }
  });

  it("终态为吸收态：迟到 running 心跳原引用返回（不复活转圈）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));
    try {
      let list = applyAgentTaskStatusEvent([], ev({}));
      list = applyAgentTaskStatusEvent(
        list,
        ev({ status: "stopped", elapsed_ms: 5_000, summary: "用户停止" }),
      );
      const frozen = list;
      vi.setSystemTime(new Date("2026-08-27T10:01:00Z"));
      // 迟到的 running 心跳（乱序重放）→ 原引用返回，状态机不回退
      expect(applyAgentTaskStatusEvent(list, ev({ last_tool_name: "Late" }))).toBe(frozen);
      // 后到终态允许覆盖定格数据（到达顺序即权威）
      const overwritten = applyAgentTaskStatusEvent(
        list,
        ev({ status: "failed", elapsed_ms: 6_000, message: "进程退出" }),
      );
      expect((overwritten[0] as AgentTaskEntry).status).toBe("failed");
      expect((overwritten[0] as AgentTaskEntry).elapsedMs).toBe(6_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("最近 6 条截断：第 7 个新任务挤掉最旧一条（终态保留供回看）", () => {
    // 逐条喂 7 个不同 task_id 的事件 → 只留最近 6 条（bg-1 被挤掉）
    let list: AgentTaskEntry[] = [];
    for (let i = 1; i <= 7; i += 1) {
      list = applyAgentTaskStatusEvent(
        list,
        ev({ task_id: `bg-${i}`, task_name: `任务${i}` }),
      );
    }
    expect(list.map((t) => t.taskId)).toEqual([
      "bg-2",
      "bg-3",
      "bg-4",
      "bg-5",
      "bg-6",
      "bg-7",
    ]);
  });
});
