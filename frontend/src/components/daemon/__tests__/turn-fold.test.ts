// 2026-10-20-session-page-dsh-alignment / D-009：折叠判定纯函数单测。
// 覆盖范围＝折叠资格（唯一决定「会不会把轮折起来」的地方）+ 步数/耗时/文案 + 正文过滤。
import { describe, expect, it } from "vitest";

import {
  foldHeaderText,
  formatFoldDuration,
  isTurnFoldable,
  processStepCount,
  textOnlySegments,
  type FoldTurnLike,
} from "../turn-fold";

function turn(over: Partial<FoldTurnLike> = {}): FoldTurnLike {
  return { status: "completed", ...over };
}

describe("isTurnFoldable：只有正常闭合的轮可整轮折叠", () => {
  it("completed → 可折", () => {
    expect(isTurnFoldable(turn({ status: "completed" }))).toBe(true);
  });

  it.each(["pending", "running", "interrupting"])("运行族 %s → 不可折（防把正在跑的轮折起来）", (status) => {
    expect(isTurnFoldable(turn({ status }))).toBe(false);
  });

  it.each(["failed", "killed"])("%s → 不可折（失败/中断原因必须留在正文里）", (status) => {
    expect(isTurnFoldable(turn({ status }))).toBe(false);
  });

  it("未知状态 → 保守不可折", () => {
    expect(isTurnFoldable(turn({ status: "whatever" }))).toBe(false);
  });
});

describe("processStepCount：只数过程段", () => {
  it("文字段/前导段/压缩摘要段不计入步数", () => {
    const t = turn({
      segments: [
        { kind: "text" },
        { kind: "preamble" },
        { kind: "compact" },
        { kind: "thinking" },
        { kind: "tool" },
      ],
    });
    expect(processStepCount(t)).toBe(2);
  });

  it("优先用 segments；没有时回退 processItems", () => {
    expect(processStepCount(turn({ processItems: [{ kind: "tool" }, { kind: "thinking" }] }))).toBe(2);
    expect(processStepCount(turn({ segments: [{ kind: "tool" }], processItems: [{ kind: "tool" }, { kind: "tool" }] }))).toBe(1);
  });

  it("无段数据 → 0 步", () => {
    expect(processStepCount(turn())).toBe(0);
  });
});

describe("formatFoldDuration：缺失不伪造", () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, null],
    [-5, null],
    [Number.NaN, null],
  ])("%s → %s", (input, expected) => {
    expect(formatFoldDuration(input as number | null | undefined)).toBe(expected);
  });

  it("毫秒/秒/分钟三档格式", () => {
    expect(formatFoldDuration(820)).toBe("820ms");
    expect(formatFoldDuration(12_300)).toBe("12.3s");
    expect(formatFoldDuration(64_000)).toBe("1m4s");
  });
});

describe("foldHeaderText：档位只改信息量", () => {
  const t = turn({ segments: [{ kind: "thinking" }, { kind: "tool" }, { kind: "text" }], apiDurationMs: 12_300 });

  it("精简档只给步数", () => {
    expect(foldHeaderText(t, "compact")).toBe("思考与工具 · 2 步");
  });

  it("标准/详细档带耗时", () => {
    expect(foldHeaderText(t, "standard")).toBe("思考与工具 · 2 步 · 12.3s");
    expect(foldHeaderText(t, "detailed")).toBe("思考与工具 · 2 步 · 12.3s");
  });

  it("耗时缺失时不出现悬空分隔符", () => {
    expect(foldHeaderText(turn({ segments: [{ kind: "tool" }] }), "standard")).toBe("思考与工具 · 1 步");
  });

  it("无过程段时降级为「过程」", () => {
    expect(foldHeaderText(turn({ segments: [{ kind: "text" }] }), "standard")).toBe("过程");
  });
});

describe("textOnlySegments：折叠时只留正文", () => {
  it("滤掉思考/工具/前导/压缩段，保留文字段与其顺序", () => {
    const segs = [
      { kind: "thinking", id: "a" },
      { kind: "text", id: "b" },
      { kind: "tool", id: "c" },
      { kind: "text", id: "d" },
    ];
    expect(textOnlySegments(segs).map((s) => s.id)).toEqual(["b", "d"]);
  });

  it("全过程段 → 空数组（调用方据此只渲染折叠头）", () => {
    expect(textOnlySegments([{ kind: "tool" }, { kind: "thinking" }])).toEqual([]);
  });
});
