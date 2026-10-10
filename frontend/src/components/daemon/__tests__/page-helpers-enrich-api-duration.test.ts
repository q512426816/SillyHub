/**
 * 2026-10-10-turn-speed-enrich-backfill-test（FR-01）：enrichDisplayTurns 对
 * apiDurationMs 的历史回填行为锁定——上变更 2026-10-10-session-turn-token-speed
 * 独立评审 P3 补课。锁三个语义：?? 链只补缺（实时值优先）、缺失兜底 null、
 * 身份稳定守卫（引用稳定防流式 memo 击穿）。纯函数直测，实现零改动。
 */
import { describe, it, expect } from "vitest";

import {
  enrichDisplayTurns,
} from "@/components/daemon/session-panel/page-helpers";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { SessionRunRead } from "@/lib/daemon/sessions";

function makeTurn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "继续任务",
    output: "好的，继续。",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: 1250,
    ctxTokens: null,
    autoResumeOf: null,
    errorDetail: null,
    segments: [],
    turnStartedAt: 12345,
    // 预置与快照派生值一致的字段（身份稳定用例要求除目标字段外全等）。
    whoLine: { profileName: null, agentName: "claude", providerName: null },
    replyAt: null,
    ...over,
  };
}

function makeRun(over: Partial<SessionRunRead> = {}): SessionRunRead {
  return {
    id: "run-1",
    created_at: "2026-10-10T00:00:00Z",
    status: "completed",
    user_id: null,
    sender_name: null,
    error_code: null,
    failure_summary: null,
    error_detail: null,
    started_at: null,
    finished_at: null,
    exit_code: 0,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: null,
    output_tokens: null,
    ...over,
  };
}

function enrich(turns: SessionTurnView[], runs: SessionRunRead[]) {
  return enrichDisplayTurns(turns, new Map(runs.map((r) => [r.id, r])), [], "claude", null);
}

describe("enrichDisplayTurns — apiDurationMs 回填（FR-01）", () => {
  it("快照回填历史轮：turn 无值 + 快照 duration_api_ms=12500 → 12500", () => {
    const [enriched] = enrich(
      [makeTurn()],
      [makeRun({ duration_api_ms: 12500 })],
    );
    expect(enriched!.apiDurationMs).toBe(12500);
  });

  it("实时值优先：turn 已有 999，快照 12500 → 保持 999 不覆盖", () => {
    const [enriched] = enrich(
      [makeTurn({ apiDurationMs: 999 })],
      [makeRun({ duration_api_ms: 12500 })],
    );
    expect(enriched!.apiDurationMs).toBe(999);
  });

  it("快照缺字段（undefined）→ 回填 null（不残留 undefined）", () => {
    const [enriched] = enrich([makeTurn()], [makeRun({})]);
    expect(enriched!.apiDurationMs).toBeNull();
  });

  it("runsMeta 未命中该 run → 原对象原引用返回", () => {
    const turn = makeTurn();
    const result = enrich([turn], [makeRun({ id: "run-other" })]);
    expect(result[0]).toBe(turn);
  });

  it("全字段一致（含 apiDurationMs=12500）→ 返回原对象引用（身份稳定守卫）", () => {
    const turn = makeTurn({ apiDurationMs: 12500 });
    const result = enrich(
      [turn],
      [makeRun({ duration_api_ms: 12500 })],
    );
    expect(result[0]).toBe(turn);
  });

  it("仅 apiDurationMs 变化（null→12500）→ 返回新对象且值回填（不击穿其余引用）", () => {
    const turn = makeTurn();
    const result = enrich(
      [turn],
      [makeRun({ duration_api_ms: 12500 })],
    );
    expect(result[0]).not.toBe(turn);
    expect(result[0]!.apiDurationMs).toBe(12500);
    // ?? 链语义逐字段镜像：未变化字段引用保持（whoLine 原引用）。
    expect(result[0]!.whoLine).toBe(turn.whoLine);
  });
});
