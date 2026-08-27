/**
 * task-15（2026-08-27-background-subagent-progress / FR-07）：
 * 子代理 async 后台派发的状态/时长推导单测（task-13 被测实现）。
 *
 * 覆盖（task 卡 implementation 逐条）：
 *   1. collectSubagents（deriveTurnActivity 派生）分叉——
 *      - 带元数据段（task-11 装配的 taskStatus / taskAsync）：metaDriven 状态由
 *        taskStatus 映射（终态即终，不再因 result 配对判 done——async 启动回执
 *        0.1s 配对不是完成信号）；仅 taskAsync 无 taskStatus 防御性 running；
 *        五字段透传（taskElapsedMs / taskAsync / taskSummary / taskToolName）；
 *      - 无元数据段：走原 result 配对推导（前台阻塞式子代理零回归）；
 *   2. SubagentCatalog 行渲染口径——运行中显示走秒（now 补秒，fake timers）；
 *        终态显示服务端真实时长 taskElapsedMs（不用 endedAt-startedAt 回执差值）；
 *        无 startedAt 的运行中回退最近 taskElapsedMs 校准值（不走秒）。
 *
 * 测试纪律对齐 turn-segment-views.test.tsx（deriveTurnActivity 纯函数区 +
 * fake timers try/finally）；SubagentCatalog 自绘 tailwind 组件不依赖 antd，
 * 行文本不被 autoLetterSpacing 拆分（getByRole name / getByText 可用）。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { deriveTurnActivity } from "@/components/daemon/turn-status-bar";
import type { SubagentActivity } from "@/components/daemon/turn-status-bar";
import { SubagentCatalog } from "@/components/sessions/subagent-catalog";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { ToolTurnSegment, TurnSegment } from "@/components/daemon/session-log-assembler";

/* ───────── fixture 构造器（每用例独立） ───────── */

/** 子文本段（collectSubagents 只收集有 children 的 tool 段，容器需非空）。 */
function makeTextSeg(id: string): TurnSegment {
  return { kind: "text", id, text: "子产出", streaming: false, startedAt: null };
}

function makeToolSeg(overrides: Partial<ToolTurnSegment> = {}): ToolTurnSegment {
  return {
    kind: "tool",
    id: "sa_1",
    raw: JSON.stringify({
      tool: "Task",
      args: { description: "后台调研" },
      tool_use_id: "sa_1",
      success: true,
    }),
    status: "ok",
    toolName: "Task",
    primary: "后台调研",
    startedAt: 1_000,
    endedAt: 5_000,
    children: [makeTextSeg("text:1")],
    subagentType: "researcher",
    ...overrides,
  };
}

/** 只读 [taskStatus / taskElapsedMs / taskAsync / taskSummary / taskToolName] 五字段。 */
function metaOf(sa: SubagentActivity | undefined) {
  if (!sa) throw new Error("subagent activity not found");
  return {
    taskStatus: sa.taskStatus,
    taskElapsedMs: sa.taskElapsedMs,
    taskAsync: sa.taskAsync,
    taskSummary: sa.taskSummary,
    taskToolName: sa.taskToolName,
  };
}

/* ───────── 1. collectSubagents 分叉（纯函数） ───────── */

describe("collectSubagents 元数据驱动分叉（task-13 / FR-07）", () => {
  it("taskAsync:true 无 taskStatus + 启动回执 result 已配对 → 防御性 running（不再因 result 判 done）", () => {
    // async 派发 0.1s 后启动回执配对（design §1：不是完成信号）——旧推导会误判
    // done + 00:00，metaDriven 后保持 running
    const seg = makeToolSeg({
      id: "sa_async",
      taskAsync: true,
      result: "已在后台启动",
      endedAt: 1_100, // 回执配对即 endedAt（差值 0.1s）
    });
    const [sa] = deriveTurnActivity([seg]).subagents;
    expect(sa?.status).toBe("running");
    expect(metaOf(sa)).toEqual({
      taskStatus: undefined,
      taskElapsedMs: undefined,
      taskAsync: true,
      taskSummary: undefined,
      taskToolName: undefined,
    });
  });

  it("taskStatus 权威映射：running（result 已配对仍 running）/ completed→done / failed→deny / stopped→stopped", () => {
    const running = deriveTurnActivity([
      makeToolSeg({ id: "sa_r", taskStatus: "running", taskAsync: true, result: "已在后台启动" }),
    ]).subagents[0];
    expect(running?.status).toBe("running"); // 终态即终的镜像：非终态也不被 result 拉成 done

    const completed = deriveTurnActivity([
      makeToolSeg({
        id: "sa_c",
        taskStatus: "completed",
        taskElapsedMs: 45_000,
        // result 未配对（终态由 NOTIFICATION 行到达，无回执）→ 终态即终仍 done
        result: undefined,
        endedAt: null,
      }),
    ]).subagents[0];
    expect(completed?.status).toBe("done");
    expect(metaOf(completed)).toMatchObject({ taskStatus: "completed", taskElapsedMs: 45_000 });

    const failed = deriveTurnActivity([
      makeToolSeg({ id: "sa_f", taskStatus: "failed", taskElapsedMs: 9_000 }),
    ]).subagents[0];
    expect(failed?.status).toBe("deny"); // failed 并入红（deny 同色系）

    const stopped = deriveTurnActivity([
      makeToolSeg({ id: "sa_s", taskStatus: "stopped", taskElapsedMs: 7_000 }),
    ]).subagents[0];
    expect(stopped?.status).toBe("stopped"); // 独立灰态
  });

  it("五字段透传：taskSummary / taskToolName 随清单透传（目录悬停摘要 / doing 行消费）", () => {
    const seg = makeToolSeg({
      id: "sa_meta",
      taskStatus: "running",
      taskAsync: true,
      taskElapsedMs: 4_200,
      taskSummary: "跑测试中",
      taskToolName: "Bash",
    });
    const [sa] = deriveTurnActivity([seg]).subagents;
    expect(metaOf(sa)).toEqual({
      taskStatus: "running",
      taskElapsedMs: 4_200,
      taskAsync: true,
      taskSummary: "跑测试中",
      taskToolName: "Bash",
    });
    // startedAt / endedAt 锚点照常透传（目录时长消费）
    expect(sa?.startedAt).toBe(1_000);
    expect(sa?.endedAt).toBe(5_000);
  });

  it("无元数据段走原 result 配对推导（前台阻塞式子代理零回归）", () => {
    const done = deriveTurnActivity([
      makeToolSeg({ id: "sa_plain_done", result: "调研结论", status: "ok" }),
    ]).subagents[0];
    expect(done?.status).toBe("done");
    expect(metaOf(done)).toEqual({
      taskStatus: undefined,
      taskElapsedMs: undefined,
      taskAsync: undefined,
      taskSummary: undefined,
      taskToolName: undefined,
    });
    // result 未配对 → running；配对但 deny → deny；stub 恒 running
    const stillRunning = deriveTurnActivity([
      makeToolSeg({ id: "sa_plain_run", result: undefined, endedAt: null }),
    ]).subagents[0];
    expect(stillRunning?.status).toBe("running");
    const denied = deriveTurnActivity([
      makeToolSeg({ id: "sa_plain_deny", result: "权限被拒", status: "deny" }),
    ]).subagents[0];
    expect(denied?.status).toBe("deny");
    const stubTurn: TurnSegment = {
      kind: "subagent_stub",
      id: "tu_stub",
      subagentType: "explore",
      children: [makeTextSeg("text:stub")],
    };
    const stub = deriveTurnActivity([stubTurn]).subagents[0];
    expect(stub?.status).toBe("running");
  });

  it("同轮分叉并存：async 元数据段 running + 前台段 done 互不干扰", () => {
    const segs = [
      makeToolSeg({ id: "sa_async_run", taskStatus: "running", taskAsync: true, result: "已在后台启动" }),
      makeToolSeg({ id: "sa_fg_done", result: "前台结论", status: "ok" }),
    ];
    const { subagents, toolCount } = deriveTurnActivity(segs);
    expect(toolCount).toBe(2);
    expect(subagents.map((s) => [s.segmentId, s.status])).toEqual([
      ["sa_async_run", "running"], // metaDriven：result 配对不判 done
      ["sa_fg_done", "done"], // 原推导：result 配对即 done
    ]);
  });
});

/* ───────── 2. SubagentCatalog 行渲染口径（走秒 / 终态时长） ───────── */

describe("SubagentCatalog 行时长口径（task-13 / FR-07）", () => {
  /** 构造最小 SessionTurnView（SubagentCatalog 只读 status + segments）。 */
  function makeTurnView(segments: TurnSegment[]): SessionTurnView {
    return {
      runId: "run-1",
      turn: 1,
      prompt: "调研一下",
      output: "",
      status: "running",
      seenLogIds: new Set<string>(),
      inputTokens: null,
      outputTokens: null,
      segments,
    };
  }

  /**
   * 三行目录：async 运行中（有 startedAt 走秒）/ async 运行中（无 startedAt，
   * 回退 taskElapsedMs 校准值不走秒）/ async 终态（服务端真实时长，回执差值
   * 迷惑项 00:01——若误用 endedAt-startedAt 会显示错值）。
   */
  function makeCatalogTurns(t0: number): SessionTurnView[] {
    return [
      makeTurnView([
        makeToolSeg({
          id: "sa_run",
          taskStatus: "running",
          taskAsync: true,
          taskSummary: "跑测试中",
          result: "已在后台启动",
          startedAt: t0 - 10_000,
          endedAt: null,
        }),
        makeToolSeg({
          id: "sa_noanchor",
          taskStatus: "running",
          taskAsync: true,
          taskElapsedMs: 8_000, // 无 startedAt → 用最近校准值
          startedAt: null,
          endedAt: null,
        }),
        makeToolSeg({
          id: "sa_done",
          taskStatus: "completed",
          taskElapsedMs: 3_723_500, // → 62:03（服务端权威）
          startedAt: 1_000,
          endedAt: 2_000, // 迷惑项：回执差值只有 00:01
        }),
      ]),
    ];
  }

  it("运行中走秒（推进 5s 秒数 +5）；终态定格服务端真实时长（不随 tick 变）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));
    try {
      const t0 = Date.now();
      render(<SubagentCatalog turns={makeCatalogTurns(t0)} />);
      // 触发按钮计数徽标：3 个子代理、2 个运行中（async running 计入）
      const trigger = screen.getByRole("button", {
        name: "子代理目录，共 3 个，2 个运行中",
      });
      fireEvent.click(trigger);
      // 初始：走秒 00:10（now - startedAt）/ 校准兜底 00:08 / 终态真实时长 62:03
      expect(screen.getByText("00:10")).toBeInTheDocument();
      expect(screen.getByText("00:08")).toBeInTheDocument();
      expect(screen.getByText("62:03")).toBeInTheDocument();
      // 推进 5s：走秒行 +5；校准兜底行不走秒（无锚点）；终态行不随 tick 变
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByText("00:15")).toBeInTheDocument();
      expect(screen.getByText("00:08")).toBeInTheDocument();
      expect(screen.getByText("62:03")).toBeInTheDocument();
      expect(screen.queryByText("00:10")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("终态时长用 taskElapsedMs 而非 endedAt-startedAt 回执差值（01:00 迷惑项不出现）", () => {
    // 单行聚焦：startedAt 0 → endedAt 60_000（差值 01:00）但服务端时长 02:05
    render(
      <SubagentCatalog
        turns={[
          makeTurnView([
            makeToolSeg({
              id: "sa_done_only",
              taskStatus: "failed",
              taskElapsedMs: 125_000,
              startedAt: 0,
              endedAt: 60_000,
            }),
          ]),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "子代理目录，共 1 个" }));
    expect(screen.getByText("02:05")).toBeInTheDocument();
    expect(screen.queryByText("01:00")).toBeNull();
  });

  it("行悬停摘要优先 taskSummary（元数据）而非内部活动推导", () => {
    render(
      <SubagentCatalog
        turns={[
          makeTurnView([
            makeToolSeg({
              id: "sa_summary",
              taskStatus: "running",
              taskAsync: true,
              taskSummary: "正在写报告",
            }),
          ]),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "子代理目录，共 1 个，1 个运行中" }));
    // title = 名 + 类型 + taskSummary（无元数据时才回退内部活动 latestActivity）。
    // 注：getByTitle 默认 normalizer 把 title 属性内的换行折叠为空格——期望串
    // 用空格形态（antd autoLetterSpacing 拆字坑不适用于本自绘组件）。
    expect(
      screen.getByTitle("后台调研 · researcher 正在写报告"),
    ).toBeInTheDocument();
  });
});
