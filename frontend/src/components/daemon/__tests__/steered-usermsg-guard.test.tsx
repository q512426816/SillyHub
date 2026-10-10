// 2026-10-10-system-opened-turn-usermsg：appendDeliveredUserMsgIfAbsent 守卫放宽
// 单测——系统注入开轮（[后台任务通知]，prompt 空 + 已有输出段）的轮，中途
// user_input 照常追加 delivered user_msg 段（不再被「prompt 为空」挡回、由
// prompt 补写路径前移到轮首顶部，run 4296aa6a 实证）。
//
// 覆盖：
//   1. prompt 空 + 有输出段（系统开轮）→ 追加 delivered 段（新行为）；
//   2. prompt 空 + 无输出段（新鲜轮）→ 原样返回（开轮正文走 prompt 写入）；
//   3. prompt 非空 + 互异主体 → 追加（既有行为不回归）；
//   4. 同主体幂等：已有同主体 user_msg 段 → 原样返回（既有行为）。
import { describe, it, expect } from "vitest";

import { appendDeliveredUserMsgIfAbsent } from "../session-panel/session-panel-page";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "../session-log-assembler";

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    segments: [],
    ...overrides,
  };
}

const TEXT_SEG: TurnSegment = {
  kind: "text",
  id: "seg-text-1",
  text: "已产出的输出",
  streaming: false,
  startedAt: 1000,
} as TurnSegment;

const MSG = "国际销售合同 不要动！";

function userMsgCount(turn: SessionTurnView): number {
  return (turn.segments ?? []).filter((s) => s.kind === "user_msg").length;
}

describe("appendDeliveredUserMsgIfAbsent 守卫放宽（2026-10-10-system-opened-turn-usermsg）", () => {
  it("prompt 空 + 已有输出段（系统通知开轮）：追加 delivered 段，不再前移轮首", () => {
    const [out] = appendDeliveredUserMsgIfAbsent(
      [makeTurn({ prompt: "", segments: [TEXT_SEG] })],
      "run-1",
      MSG,
      2000,
    );
    expect(out).toBeTruthy();
    expect(out!.prompt).toBe(""); // 不写 prompt（顶部无用户气泡）
    expect(userMsgCount(out!)).toBe(1);
    const seg = out!.segments!.find((s) => s.kind === "user_msg") as {
      text: string;
      ts: number | null;
      phase: string;
    };
    expect(seg.text).toBe(MSG);
    expect(seg.ts).toBe(2000);
    expect(seg.phase).toBe("delivered");
  });

  it("prompt 空 + 无输出段（新鲜轮）：原样返回——开轮正文走 prompt 写入路径", () => {
    const turns = [makeTurn({ prompt: "", segments: [] })];
    const out = appendDeliveredUserMsgIfAbsent(turns, "run-1", MSG, 2000);
    expect(out).toBe(turns); // 原引用（零重渲）
    expect(userMsgCount(out[0]!)).toBe(0);
  });

  it("prompt 非空 + 互异主体：照常追加（既有行为不回归）", () => {
    const [out] = appendDeliveredUserMsgIfAbsent(
      [makeTurn({ prompt: "第一句", segments: [TEXT_SEG] })],
      "run-1",
      MSG,
      2000,
    );
    expect(out!.prompt).toBe("第一句");
    expect(userMsgCount(out!)).toBe(1);
  });

  it("已有同主体 user_msg 段：幂等原样返回（既有行为）", () => {
    const turns = [
      makeTurn({
        prompt: "第一句",
        segments: [
          TEXT_SEG,
          { kind: "user_msg", id: "steer:1", text: MSG, ts: 1900, phase: "delivered" },
        ] as unknown as TurnSegment[],
      }),
    ];
    const out = appendDeliveredUserMsgIfAbsent(turns, "run-1", MSG, 2000);
    expect(out).toBe(turns);
    expect(userMsgCount(out[0]!)).toBe(1);
  });
});
