// 2026-10-22-session-trajectory-view（D-035）适配器单测：
//   SessionTurnView[] → Trajectory（rows/turns/lanes/coverage/modelBasis）
//
// 锁定契约（design「轨迹装配器」+ D-024/D-026 口径）：
//   1. 段映射：text→assistant / thinking→thinking / tool→tool（toolName 保留）；
//   2. 轮边界：turnStartedAt 起、replyAt 止；无任何锚点的轮**跳过**（不伪造 now）；
//   3. 预览条目（turn.preview）不参与轨迹；
//   4. 泳道齐备 + coverage.modelMs + toolMs ≤ windowMs + 无 timing → approx；
//      带 timing attempts → observed（真实占用，D-035②）；
//   5. 同一输入恒同输出（纯函数，无 Date.now）。
import { describe, expect, it } from "vitest";

import { trajectoryFromTurnViews } from "../from-turn-views";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";

const START = Date.parse("2026-10-21T10:00:00.000Z");
const START_ISO = new Date(START).toISOString();
const END_ISO = new Date(START + 60_000).toISOString();

function seg(...items: TurnSegment[]): TurnSegment[] {
  return items;
}

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "跑一下测试",
    output: "好了",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: 10,
    outputTokens: 20,
    turnStartedAt: START,
    replyAt: END_ISO,
    segments: seg(
      { kind: "thinking", id: "th-1", text: "想一下", streaming: false, ts: START + 1_000 },
      {
        kind: "tool",
        id: "tool-1",
        raw: "{}",
        status: "ok",
        toolName: "Bash",
        primary: "pnpm test",
        startedAt: START + 5_000,
        endedAt: START + 20_000,
        children: [],
        subagentType: null,
      },
      { kind: "text", id: "tx-1", text: "好了", streaming: false, startedAt: START + 30_000 },
    ),
    ...overrides,
  };
}

describe("trajectoryFromTurnViews：轮视图 → 三泳道轨迹", () => {
  it("段映射：thinking/tool/text 各成一行，toolName 与 tool 状态保留", () => {
    const traj = trajectoryFromTurnViews([makeTurn()]);

    const kinds = traj.rows.map((r) => r.kind);
    expect(kinds).toContain("user");
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("tool");
    expect(kinds).toContain("assistant");

    const tool = traj.rows.find((r) => r.kind === "tool")!;
    expect(tool.toolName).toBe("Bash");
    expect(tool.startedAt).toBe(START + 5_000);
    expect(tool.endedAt).toBe(START + 20_000);
    expect(tool.status).toBe("ok");
  });

  it("轮边界取 turnStartedAt → replyAt；tokens 透传", () => {
    const traj = trajectoryFromTurnViews([makeTurn()]);

    expect(traj.turns).toHaveLength(1);
    const turn = traj.turns[0]!;
    expect(turn.runId).toBe("run-1");
    expect(turn.startedAt).toBe(START);
    expect(turn.endedAt).toBe(Date.parse(END_ISO));
    expect(turn.durationMs).toBe(60_000);
    expect(turn.inputTokens).toBe(10);
    expect(turn.outputTokens).toBe(20);
  });

  it("三泳道齐备，且 coverage.modelMs + toolMs ≤ windowMs（不越窗）", () => {
    const traj = trajectoryFromTurnViews([makeTurn()]);

    expect(traj.lanes.input.length).toBeGreaterThan(0);
    expect(traj.lanes.tool.length).toBeGreaterThan(0);
    expect(traj.lanes.model.length).toBeGreaterThan(0);
    const windowMs = traj.windowEnd - traj.windowStart;
    expect(traj.coverage.modelMs + traj.coverage.toolMs).toBeLessThanOrEqual(windowMs);
  });

  it("轮视图无 timing → modelBasis 恒 approx（不冒充真实占用）", () => {
    const traj = trajectoryFromTurnViews([makeTurn()]);
    expect(traj.modelBasis).toBe("approx");
  });

  it("轮视图带 /runs timing（attempts 可解析）→ modelBasis=observed（真实占用）", () => {
    // D-035②：page-helpers 把 `/runs` 的 timing 透传到轮视图，适配器必须把它当
    // 真实采样交给装配器——模型泳道切 observed，且 attempt 区间进入窗口。
    const traj = trajectoryFromTurnViews([
      makeTurn({
        timing: {
          runId: "run-1",
          basis: "observed",
          totalMs: 60_000,
          ttftMs: 800,
          attempts: [
            {
              index: 0,
              model: "claude-sonnet",
              startedAt: START_ISO,
              endedAt: new Date(START + 4_000).toISOString(),
              firstTokenAt: new Date(START + 800).toISOString(),
            },
          ],
        },
      }),
    ]);

    expect(traj.modelBasis).toBe("observed");
    const model = traj.lanes.model;
    expect(model.length).toBeGreaterThan(0);
    expect(model.every((s) => s.start >= START && s.end <= START + 4_000)).toBe(true);
  });

  it("无任何时间锚点的轮被跳过（不伪造 now / 不补 0）", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({ turnStartedAt: null, replyAt: null, segments: [] }),
    ]);
    expect(traj.rows).toEqual([]);
    expect(traj.turns).toEqual([]);
    expect(traj.windowStart).toBe(0);
    expect(traj.windowEnd).toBe(0);
  });

  it("预览条目（未加载轮）不参与轨迹", () => {
    const preview = makeTurn({
      runId: "run-preview",
      preview: { promptSummary: "摘要", startedAt: START_ISO },
    });
    const traj = trajectoryFromTurnViews([preview, makeTurn()]);
    expect(traj.turns).toHaveLength(1);
    expect(traj.rows.some((r) => r.id.startsWith("run-preview"))).toBe(false);
  });

  it("纯函数：同输入两次调用结果一致（无时间源/无全局态）", () => {
    const first = trajectoryFromTurnViews([makeTurn()]);
    const second = trajectoryFromTurnViews([makeTurn()]);
    expect(second.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    expect(second.windowStart).toBe(first.windowStart);
    expect(second.coverage).toEqual(first.coverage);
  });

  it("多轮：轮号按出现顺序 1..N，行 stepIndex 轮内从 1 递增", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn(),
      makeTurn({
        runId: "run-2",
        turn: 2,
        turnStartedAt: START + 120_000,
        replyAt: new Date(START + 180_000).toISOString(),
      }),
    ]);
    expect(traj.turns.map((t) => t.index)).toEqual([1, 2]);
    for (const turn of traj.turns) {
      const steps = traj.rows
        .filter((r) => r.turnIndex === turn.index)
        .map((r) => r.stepIndex);
      expect(steps).toEqual(steps.map((_, i) => i + 1));
    }
  });
});

describe("产品路径数据边界与工具行映射（2026-10-22-trajectory-view-redesign）", () => {
  it("产品路径只派发六类行型（无 tool_result / error 行）", () => {
    const traj = trajectoryFromTurnViews([makeTurn({ processItems: undefined })]);
    const allowed = new Set(["user", "assistant", "thinking", "tool", "system", "compaction"]);

    for (const row of traj.rows) {
      expect(allowed.has(row.kind)).toBe(true);
    }
    expect(traj.rows.some((row) => row.kind === "tool_result")).toBe(false);
    expect(traj.rows.some((row) => row.kind === "error")).toBe(false);
  });

  it("工具行：raw → inputText、result → outputText", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({
        segments: seg({
          kind: "tool",
          id: "tool-r",
          raw: '{"command":"pnpm test"}',
          result: "all green",
          status: "ok",
          toolName: "Bash",
          primary: "pnpm test",
          startedAt: START + 5_000,
          endedAt: START + 20_000,
          children: [],
          subagentType: null,
        }),
      }),
    ]);

    const tool = traj.rows.find((row) => row.kind === "tool")!;
    expect(tool.inputText).toContain("pnpm test");
    expect(tool.outputText).toBe("all green");
    expect(tool.meta?.resultFromPrimary).toBeUndefined();
  });

  it("结果缺失时退回 primary 并标记 resultFromPrimary（详情标注未捕获结果）", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({
        segments: seg({
          kind: "tool",
          id: "tool-nr",
          raw: '{"command":"pnpm lint"}',
          status: "ok",
          toolName: "Bash",
          primary: "pnpm lint",
          startedAt: START + 5_000,
          endedAt: START + 20_000,
          children: [],
          subagentType: null,
        }),
      }),
    ]);

    const tool = traj.rows.find((row) => row.kind === "tool")!;
    expect(tool.outputText).toBe("pnpm lint");
    expect(tool.meta?.resultFromPrimary).toBe(true);
  });
});

describe("system_event 派生为上下文行（2026-10-22-trajectory-context-jump / FR-01）", () => {
  it("system_event 派生为上下文行：原文摘要 + ts 锚点 + 无事件轮零变化", () => {
    const withEvent = trajectoryFromTurnViews([
      makeTurn({
        processItems: [
          { kind: "system_event", text: "Agent sent a message", ts: START + 10_000 },
          { kind: "system_event", text: "Background subagent finished" },
        ],
      }),
    ]);
    const ctxRows = withEvent.rows.filter((row) => row.meta?.contextEvent);
    expect(ctxRows).toHaveLength(2);

    const first = ctxRows.find((row) => row.outputText === "Agent sent a message")!;
    expect(first.kind).toBe("system");
    expect(first.startedAt).toBe(START + 10_000);
    // 缺 ts 的项落到轮首锚点（turnStartedAt=START），不伪造。
    const second = ctxRows.find((row) => row.outputText === "Background subagent finished")!;
    expect(second.startedAt).toBe(START);

    // 零回归：无 system_event 的轮行集合与派生前一致（上下文行不出现）。
    const withoutEvent = trajectoryFromTurnViews([makeTurn()]);
    expect(withoutEvent.rows.some((row) => row.meta?.contextEvent)).toBe(false);
    expect(withoutEvent.rows.map((row) => row.id)).toEqual(
      trajectoryFromTurnViews([makeTurn()]).rows.map((row) => row.id),
    );
  });
});

describe("turn_trigger 段派生与锚点（2026-10-24-trajectory-context-rows）", () => {
  it("turn_trigger 段派生为上下文行：通知原文 + ts 锚点 + 不再标用户", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({
        segments: seg(
          {
            kind: "turn_trigger",
            id: "tt-1",
            text: "[后台任务通知] 任务完成",
            ts: START + 10_000,
            trigger: "task_wakeup",
          },
          { kind: "thinking", id: "th-1", text: "想一下", streaming: false, ts: START + 20_000 },
        ),
      }),
    ]);

    const ctx = traj.rows.find((row) => row.meta?.contextEvent);
    expect(ctx).toBeDefined();
    expect(ctx!.kind).toBe("system");
    expect(ctx!.outputText).toBe("[后台任务通知] 任务完成");
    // ts 锚点生效：不再挤在轮首（turnStartedAt=START）。
    expect(ctx!.startedAt).toBe(START + 10_000);
    // 排序：上下文行（+10s）在 thinking（+20s）之前。
    expect(ctx!.startedAt).toBeLessThan(
      traj.rows.find((row) => row.kind === "thinking")!.startedAt,
    );
  });

  it("user_msg 段保持「用户」行，锚点取 ts（不挤轮首）", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({
        segments: seg(
          {
            kind: "user_msg",
            id: "um-1",
            text: "中途追问",
            ts: START + 15_000,
            phase: "delivered",
          },
        ),
      }),
    ]);

    const um = traj.rows.find((row) => row.inputText === "中途追问");
    expect(um).toBeDefined();
    expect(um!.kind).toBe("user");
    expect(um!.meta?.contextEvent).toBeUndefined();
    expect(um!.startedAt).toBe(START + 15_000);
  });
});

describe("请求头快照段派生系统行（2026-10-25-trajectory-source-model FR-03）", () => {
  function headerSeg(
    header: { systemPrompt: string | null; allowedTools: string[]; mcpServers: string[] },
    prev: { systemPrompt: string | null; allowedTools: string[]; mcpServers: string[] } | null,
    ts: number,
  ) {
    return {
      kind: "request_header",
      id: `header-${ts}`,
      header,
      prev,
      ts,
    } as never;
  }

  const H1 = { systemPrompt: "指令A", allowedTools: ["Bash"], mcpServers: ["mcp1"] };

  it("首条快照（prev=null）→ 初始系统提示词（initial）", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({ segments: seg(headerSeg(H1, null, START + 1_000) as never) }),
    ]);
    const headerRow = traj.rows.find((row) => row.meta?.headerChange);
    expect(headerRow).toBeDefined();
    expect(headerRow!.kind).toBe("system");
    expect(headerRow!.meta!.headerChange).toBe("initial");
    expect(headerRow!.startedAt).toBe(START + 1_000);
  });

  it("systemPrompt 变更 → system；工具清单变更 → tools；双变更 → system-and-tools", () => {
    const cases: Array<
      [
        { systemPrompt: string | null; allowedTools: string[]; mcpServers: string[] },
        { systemPrompt: string | null; allowedTools: string[]; mcpServers: string[] },
        string,
      ]
    > = [
      [{ ...H1, systemPrompt: "指令B" }, H1, "system"],
      [{ ...H1, allowedTools: ["Bash", "Read"] }, H1, "tools"],
      [
        { ...H1, systemPrompt: "指令B", mcpServers: ["mcp1", "mcp2"] },
        H1,
        "system-and-tools",
      ],
    ];
    for (const [header, prev, expected] of cases) {
      const traj = trajectoryFromTurnViews([
        makeTurn({ segments: seg(headerSeg(header, prev, START + 1_000) as never) }),
      ]);
      const headerRow = traj.rows.find((row) => row.meta?.headerChange);
      expect(headerRow!.meta!.headerChange).toBe(expected);
    }
  });

  it("prev 相同（daemon 重复上报 initial）→ diff 仍按 prev 判（不误报初始）", () => {
    const traj = trajectoryFromTurnViews([
      makeTurn({ segments: seg(headerSeg(H1, H1, START + 1_000) as never) }),
    ]);
    const headerRow = traj.rows.find((row) => row.meta?.headerChange);
    expect(headerRow!.meta!.headerChange).toBe("initial");
  });
});
