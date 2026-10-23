// 2026-10-23-session-first-load-ux / FR-02：首屏自适应窗口增量合并纯函数单测。
//
// 锁定的行为（design「风险与死路」承诺的四形态）：
//   1. 未扩展（小会话全量 / 锚点不完整整体回退）→ 空 prepend / 空 replace；
//   2. 仅锚点轮直达合并 → 锚点轮整轮一块（含底窗段 + 补齐段）+ 摘底窗旧块
//      （replaceRunIds={锚点 run}）；
//   3. 锚点 + 更早轮（earlierRuns）→ 块序 = 更早轮在前、锚点整轮在后；
//   4. extended=true 但窗口与底窗无差集（防御形态）→ 空。
//
// 通用契约：prepend 块 runId 带 `#w<窗口键>` 后缀（防 React key 撞），realRunId
// 保持真实 run id（SSE 增量 / enrich 快照认领按 realRunId 不受影响）。
import { describe, it, expect } from "vitest";

import type { AgentRunLogEntry } from "@/lib/agent";
import type { InitialWindowResult } from "../initial-window";
import {
  buildInitialWindowMerge,
  filterPrependAgainstExisting,
} from "../initial-window-merge";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";

let seq = 0;
function log(
  runId: string,
  ts: string,
  channel: "user_input" | "stdout" = "stdout",
  content = "内容",
): AgentRunLogEntry {
  seq += 1;
  return {
    id: `log-${String(seq).padStart(3, "0")}`,
    run_id: runId,
    timestamp: ts,
    channel,
    content_redacted: content,
  };
}

/** 底窗：run-A 2 行（时间最旧，含被截断的锚点轮）+ run-B 2 行 + run-C 1 行。 */
function makeBaseLogs(): AgentRunLogEntry[] {
  return [
    log("run-A", "2026-10-23T10:00:01Z", "stdout", "A 中段"),
    log("run-A", "2026-10-23T10:00:02Z", "stdout", "A 尾段"),
    log("run-B", "2026-10-23T11:00:01Z", "user_input", "B 提问"),
    log("run-B", "2026-10-23T11:00:02Z", "stdout", "B 回答"),
    log("run-C", "2026-10-23T12:00:01Z", "user_input", "C 提问"),
  ];
}

function adaptiveOf(
  logs: AgentRunLogEntry[],
  extended: boolean,
  cursorLog: AgentRunLogEntry | null,
): InitialWindowResult {
  return { logs, extended, cursorLog };
}

describe("buildInitialWindowMerge（2026-10-23-session-first-load-ux）", () => {
  it("未扩展（回退/小会话）→ 零增量零摘除", () => {
    const base = makeBaseLogs();
    const r = buildInitialWindowMerge(
      base,
      adaptiveOf(base, false, null),
    );
    expect(r.prependTurns).toHaveLength(0);
    expect(r.replaceRunIds.size).toBe(0);
  });

  it("extended=true 但窗口与底窗无差集（防御）→ 零增量零摘除", () => {
    const base = makeBaseLogs();
    const r = buildInitialWindowMerge(
      base,
      adaptiveOf([...base], true, null),
    );
    expect(r.prependTurns).toHaveLength(0);
    expect(r.replaceRunIds.size).toBe(0);
  });

  it("仅锚点轮直达合并 → 整轮一块 prepend + 摘底窗锚点旧块", () => {
    const base = makeBaseLogs();
    // 直达补齐 run-A 轮首两行（user_input + 早段）——adaptive 该轮 = 整轮 5 行。
    const anchorFull = [
      log("run-A", "2026-10-23T09:59:59Z", "user_input", "A 提问"),
      log("run-A", "2026-10-23T10:00:00Z", "stdout", "A 早段"),
      ...base.filter((l) => l.run_id === "run-A"),
    ];
    const adaptiveLogs = [
      ...anchorFull,
      ...base.filter((l) => l.run_id !== "run-A"),
    ];
    const r = buildInitialWindowMerge(
      base,
      adaptiveOf(adaptiveLogs, true, anchorFull[0]!),
    );

    // 一块（run-A 整轮），runId 带 #w 窗口键、realRunId 保持真实 id。
    expect(r.prependTurns).toHaveLength(1);
    const block = r.prependTurns[0]!;
    expect(block.runId).toMatch(/^run-A#w/);
    expect(block.realRunId).toBe("run-A");
    // 整轮语义：prompt 取轮首 user_input（补齐段带回的提问），底窗段行并入同块
    //（2 补齐行 + 2 底窗行 = 4 行进 seenLogIds）。
    expect(block.prompt).toContain("A 提问");
    expect([...block.seenLogIds!]).toHaveLength(4);
    // 摘底窗锚点旧块。
    expect(r.replaceRunIds.has("run-A")).toBe(true);
  });

  it("锚点 + 更早轮 → 块序 = 更早轮在前、锚点整轮在后", () => {
    const base = makeBaseLogs();
    const earlier = [
      log("run-0", "2026-10-23T08:00:01Z", "user_input", "更早轮提问"),
      log("run-0", "2026-10-23T08:00:02Z", "stdout", "更早轮回答"),
    ];
    const anchorFull = [
      log("run-A", "2026-10-23T09:59:59Z", "user_input", "A 提问"),
      ...base.filter((l) => l.run_id === "run-A"),
    ];
    const adaptiveLogs = [
      ...earlier,
      ...anchorFull,
      ...base.filter((l) => l.run_id !== "run-A"),
    ];
    const r = buildInitialWindowMerge(
      base,
      adaptiveOf(adaptiveLogs, true, earlier[0]!),
    );

    expect(r.prependTurns).toHaveLength(2);
    // 块序：时间早的更早轮在前。
    expect(r.prependTurns[0]!.realRunId).toBe("run-0");
    expect(r.prependTurns[0]!.runId).toMatch(/^run-0#w/);
    expect(r.prependTurns[1]!.realRunId).toBe("run-A");
    expect(r.replaceRunIds.has("run-A")).toBe(true);
    expect(r.replaceRunIds.has("run-0")).toBe(false);
  });
});

/* 评审 P2 回归证伪：过滤逻辑必须是可独立断言的纯函数——渲染层
 * mergePreviewIntoDisplayTurns 会按 outline key 去重，端到端「块数」断言在
 * 删掉过滤后仍可能为绿，无法证伪。本组用例直接断言函数产物。 */
function turnView(overrides: Partial<SessionTurnView>): SessionTurnView {
  return {
    runId: "run-x",
    realRunId: "run-x",
    turn: 1,
    prompt: "",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

describe("filterPrependAgainstExisting（评审 P2 回归）", () => {
  it("已有同 run 且有内容的块（含 #e 变体）→ 剔除对应 prepend 块", () => {
    const existing = [
      turnView({ runId: "run-0#e123-abcdef12", realRunId: "run-0", prompt: "已加载提问" }),
    ];
    const prepend = [
      turnView({ runId: "run-0#w456-abcdef12", realRunId: "run-0", prompt: "整窗提问" }),
      turnView({ runId: "run-1#w456-abcdef12", realRunId: "run-1", prompt: "另一轮" }),
    ];
    const kept = filterPrependAgainstExisting(prepend, existing);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.realRunId).toBe("run-1");
  });

  it("已有同 run 但为空壳（无 prompt/segments/output）→ 保留 prepend（整轮内容覆盖）", () => {
    const existing = [turnView({ runId: "run-0", realRunId: "run-0" })];
    const prepend = [
      turnView({ runId: "run-0#w456-abcdef12", realRunId: "run-0", prompt: "整窗提问" }),
    ];
    expect(filterPrependAgainstExisting(prepend, existing)).toHaveLength(1);
  });

  it("无冲突 → 原样返回全部 prepend（引用序列不变）", () => {
    const prepend = [
      turnView({ runId: "run-a#w1", realRunId: "run-a", output: "A" }),
      turnView({ runId: "run-b#w1", realRunId: "run-b", output: "B" }),
    ];
    expect(
      filterPrependAgainstExisting(prepend, []).map((t) => t.realRunId),
    ).toEqual(["run-a", "run-b"]);
  });
});
