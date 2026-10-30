/**
 * 2026-10-20-session-error-visibility（FR-01/FR-03）：enrichDisplayTurns 对
 * interactive_interrupted 失败轮的错误可见性判定锁定。生产实证（会话 71419980）：
 * backend 对 SDK error_during_execution（含全部模型错误）统一落
 * error_code=interactive_interrupted，前端 runTerminalTurnStatus 归 killed
 * 「已中止」不回填 errorDetail → 错误卡永不渲染。本变更精化：killed 且
 * meta.status=failed 且 error_detail 可解析出模型错误 → 升级 failed +
 * errorDetail；真打断（error_detail 空/无模型错误键）保持 killed 零回归。
 */
import { describe, it, expect } from "vitest";

import {
  enrichDisplayTurns,
} from "@/components/daemon/session-panel/page-helpers";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { SessionRunRead } from "@/lib/daemon/sessions";

const MODEL_ERROR_DETAIL = {
  type: "unknown",
  code: null,
  message: "运行失败",
  retryable: false,
  hint: null,
  raw: "codex exited code=1",
  reset_at: null,
};

function makeTurn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "你好",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    autoResumeOf: null,
    errorDetail: null,
    segments: [],
    turnStartedAt: 12345,
    whoLine: { profileName: null, agentName: "codex", providerName: null },
    replyAt: null,
    ...over,
  };
}

function makeRun(over: Partial<SessionRunRead> = {}): SessionRunRead {
  return {
    id: "run-1",
    created_at: "2026-10-20T03:00:17Z",
    status: "failed",
    user_id: null,
    sender_name: null,
    error_code: "interactive_interrupted",
    failure_summary: "codex exited code=1",
    error_detail: MODEL_ERROR_DETAIL,
    started_at: null,
    finished_at: "2026-10-20T03:00:17.95Z",
    exit_code: 1,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: null,
    output_tokens: null,
    ...over,
  };
}

function enrich(turns: SessionTurnView[], runs: SessionRunRead[]) {
  return enrichDisplayTurns(turns, new Map(runs.map((r) => [r.id, r])), [], "codex", null);
}

describe("enrichDisplayTurns — interactive_interrupted 错误可见性（FR-01）", () => {
  it("模型失败（failed+interrupted+error_detail 非空）→ 升级 failed 并回填 errorDetail", () => {
    const [enriched] = enrich([makeTurn()], [makeRun()]);
    expect(enriched!.status).toBe("failed");
    expect(enriched!.errorDetail).not.toBeNull();
    expect(enriched!.errorDetail!.raw).toBe("codex exited code=1");
  });

  it("实时先落 killed 的轮，快照到达后同样升级 failed（两步收敛）", () => {
    const [enriched] = enrich(
      [makeTurn({ status: "killed" })],
      [makeRun()],
    );
    expect(enriched!.status).toBe("failed");
    expect(enriched!.errorDetail!.raw).toBe("codex exited code=1");
  });

  it("run 快照 error_detail 优先于 turn 日志兜底（2026-10-30 评审 P1）", () => {
    const [enriched] = enrich(
      [
        makeTurn({
          errorDetail: {
            type: "quota_exceeded",
            code: "1308",
            message: "供应商额度或用量已达上限",
            retryable: false,
            hint: null,
            raw: "API Error: Request rejected (429)",
          },
        }),
      ],
      [makeRun()],
    );
    // daemon/run 快照回传的 error_detail（MODEL_ERROR_DETAIL）必须优先，
    // 日志兜底不得覆盖其 code/raw/类型。
    expect(enriched!.errorDetail!.raw).toBe("codex exited code=1");
    expect(enriched!.errorDetail!.type).toBe("unknown");
  });

  it("run 快照无 error_detail 时保留 turn 日志兜底（额度卡）", () => {
    const [enriched] = enrich(
      [
        makeTurn({
          status: "failed",
          errorDetail: {
            type: "quota_exceeded",
            code: "1308",
            message: "供应商额度或用量已达上限",
            retryable: false,
            hint: null,
            raw: "API Error: Request rejected (429)",
          },
        }),
      ],
      [makeRun({ error_detail: null, failure_summary: null })],
    );
    expect(enriched!.errorDetail!.type).toBe("quota_exceeded");
    expect(enriched!.errorDetail!.code).toBe("1308");
  });

  it("非 interrupted 的 failed（interactive_failed）→ failed + errorDetail（既有行为锁定）", () => {
    const [enriched] = enrich(
      [makeTurn()],
      [makeRun({ error_code: "interactive_failed", error_detail: MODEL_ERROR_DETAIL })],
    );
    expect(enriched!.status).toBe("failed");
    expect(enriched!.errorDetail!.raw).toBe("codex exited code=1");
  });
});

describe("enrichDisplayTurns — 真打断零回归（FR-03）", () => {
  it("error_detail 为空（真打断）→ 保持 killed 且不出现错误卡", () => {
    const [enriched] = enrich(
      [makeTurn()],
      [makeRun({ error_detail: null })],
    );
    expect(enriched!.status).toBe("killed");
    expect(enriched!.errorDetail).toBeNull();
  });

  it("error_detail 无模型错误键（系统级 dict）→ 保持 killed", () => {
    const [enriched] = enrich(
      [makeTurn()],
      [
        makeRun({
          error_detail: { reason: "startup_cleanup", finished_by: "reaper" },
        }),
      ],
    );
    expect(enriched!.status).toBe("killed");
    expect(enriched!.errorDetail).toBeNull();
  });

  it("interrupted/cancelled 状态（非 failed）→ 保持 killed（现状语义不触碰）", () => {
    const [enriched] = enrich(
      [makeTurn()],
      [makeRun({ status: "interrupted", error_code: null, error_detail: null })],
    );
    expect(enriched!.status).toBe("killed");
  });
});
