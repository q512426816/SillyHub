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
