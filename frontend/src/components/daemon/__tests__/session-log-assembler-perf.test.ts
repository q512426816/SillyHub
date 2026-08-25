/**
 * F7（2026-08-25 frontend 第二轮优化）：applyLogToSegments 增量投影性质回归。
 *
 * 背景：改前每条内容变更日志都全量重投影（segmentsToLegacy 全树 DFS）+ 每条复制
 * 整个 seenLogIds Set + 每新段全树收集 id，流式 partial 逐条到达时单轮累计 O(n²)。
 * 改后热路径（同源 partial 续接 DFS 末位段）O(1) 增量，结构变更 / 撤回兜底全量。
 *
 * 断言策略（vitest 无法 spy 模块内部调用，legacyProjectionBuildsForTest 为测试
 * 观测导出）：
 *   1. 全量投影次数：N=200 条同源 partial 灌入后 ≤ 小常数（实现语义：首段建立
 *      cell 一次 + 首条日志一次）；
 *   2. 增量值与全量重算逐字节对拍（output / processItems），含混合结构变更序列
 *      逐步对拍——正确性锚；
 *   3. processItems 引用稳定（text partial 续接不重建数组）；
 *   4. StrictMode double-invoke 幂等（同 (Set, logId) 立即重放复返同一产物）与
 *      真迟到重放语义不变；
 *   5. 撤回同步 id 索引（撤回后同 base 新段不带多余后缀）；
 *   6. 内部状态随对象展开（session-panel merge 形态）流转不断链。
 */

import { describe, it, expect } from "vitest";

import {
  applyLogToSegments,
  createEmptyAssembledTurn,
  finishTurn,
  legacyProjectionBuildsForTest,
  logsToSegments,
  segmentsToLegacy,
  transferAssemblerInternals,
} from "../session-log-assembler";
import type { AssembledTurn, AssemblerLogInput } from "../session-log-assembler";

function makeLog(
  id: string | null,
  channel: string | null,
  content: string,
  extra?: Partial<AssemblerLogInput>,
): AssemblerLogInput {
  return { logId: id, channel, content, timestamp: null, ...extra };
}

const TOOL_RAW = '{"tool":"Bash","args":{"command":"ls"},"tool_use_id":"tu_a","success":true}';
const TASK_RAW = '{"tool":"Task","args":{"description":"子代理"},"tool_use_id":"tu_t","success":true}';

describe("F7 增量投影（流式热路径 O(1)，值与全量重算一致）", () => {
  it("200 条同源 partial（大文本）：全量投影 ≤2 次，processItems 引用稳定，终值对拍一致", () => {
    const N = 200;
    const CHUNK = "长文本分片内容，用于模拟流式 partial 逐条到达的负载场景。".repeat(3);
    const before = legacyProjectionBuildsForTest();

    let turn = createEmptyAssembledTurn();
    turn = applyLogToSegments(turn, makeLog("p0", "stdout", "开场白"));
    turn = applyLogToSegments(turn, makeLog("p1", "stdout", CHUNK, { segmentId: "main:m1:1" }));
    const itemsRef = turn.processItems;
    for (let i = 2; i <= N; i += 1) {
      turn = applyLogToSegments(turn, makeLog(`p${i}`, "stdout", CHUNK, { segmentId: "main:m1:1" }));
    }

    // 性质：除首条（cell 建立）与首 partial（建段）外全部增量，无全量重投影
    expect(legacyProjectionBuildsForTest() - before).toBeLessThanOrEqual(2);
    // 性质：text partial 续接不重建 processItems 数组（引用复用）
    expect(turn.processItems).toBe(itemsRef);
    // 正确性对拍：与显式全量重算逐字节一致
    const full = segmentsToLegacy(turn.segments);
    expect(turn.output).toBe(full.output);
    expect(turn.processItems).toEqual(full.processItems);
    expect(turn.output).toBe(`开场白${CHUNK.repeat(N)}`);
  });

  it("thinking partial 续接（DFS 末位过程项）：终值对拍一致，全量投影 ≤2 次", () => {
    const N = 100;
    const before = legacyProjectionBuildsForTest();
    let turn = applyLogToSegments(
      createEmptyAssembledTurn(),
      makeLog("t0", null, "[THINKING] 首段思考"),
    );
    turn = applyLogToSegments(turn, makeLog("t1", null, "[THINKING] partial-1", { segmentId: "main:th:1" }));
    for (let i = 2; i <= N; i += 1) {
      turn = applyLogToSegments(
        turn,
        makeLog(`t${i}`, null, `[THINKING] partial-${i}`, { segmentId: "main:th:1" }),
      );
    }
    expect(legacyProjectionBuildsForTest() - before).toBeLessThanOrEqual(2);
    const full = segmentsToLegacy(turn.segments);
    expect(turn.output).toBe(full.output);
    expect(turn.processItems).toEqual(full.processItems);
    // 无 segmentId 首段与 partial 派生段隔离（ql-20260820-011）→ 两项；partial 侧合并为一项
    expect(turn.processItems).toHaveLength(2);
  });

  it("混合序列（工具穿插 / 撤回 / 子代理嵌套 / stderr / 孤儿 result / finishTurn）逐步对拍一致", () => {
    const ts = "2026-08-25T10:00:00.000Z";
    const seq: AssemblerLogInput[] = [
      makeLog("1", "stdout", "前文", { timestamp: ts }),
      makeLog("2", "stdout", "partial-A", { segmentId: "main:msg1:1", timestamp: ts }),
      makeLog("3", "tool_call", TOOL_RAW, { timestamp: ts }),
      makeLog("4", "stdout", "partial-B", { segmentId: "main:msg1:1", timestamp: ts }),
      makeLog("5", null, "[THINKING] 思考A", { timestamp: ts }),
      makeLog("6", null, "[THINKING] 续接", { timestamp: ts }),
      makeLog("7", "stderr", "告警", { timestamp: ts }),
      makeLog("8", "tool_call", TASK_RAW, { timestamp: ts }),
      makeLog("9", "stdout", "子partial-1", { parentToolUseId: "tu_t", segmentId: "tu_t:1", timestamp: ts }),
      makeLog("10", "stdout", "子partial-2", { parentToolUseId: "tu_t", segmentId: "tu_t:1", timestamp: ts }),
      makeLog("11", null, "[ASSISTANT_OVERRIDE] main:msg1:1"),
      makeLog("12", "stdout", "partial-C", { segmentId: "main:msg2:1", timestamp: ts }),
      makeLog("13", "stdout", "[TOOL_RESULT] 孤儿结果", { timestamp: ts }),
      makeLog("14", "stdout", "partial-D", { segmentId: "main:msg2:1", timestamp: ts }),
      makeLog("15", "stdout", "", { timestamp: ts }),
    ];
    let turn = createEmptyAssembledTurn();
    for (const log of seq) {
      turn = applyLogToSegments(turn, log);
      const full = segmentsToLegacy(turn.segments);
      expect(turn.output).toBe(full.output);
      expect(turn.processItems).toEqual(full.processItems);
    }
    // 树非平凡（防空等对拍空转）：工具 / 撤回 / 嵌套 / 孤儿均命中
    expect(turn.segments.length).toBeGreaterThanOrEqual(4);
    const done = finishTurn(turn);
    expect(done.output).toBe(turn.output);
    expect(done.processItems).toEqual(turn.processItems);
  });

  it("StrictMode double-invoke 幂等：同 (Set, logId) 立即重放复返同一产物，内容不丢", () => {
    let turn = applyLogToSegments(createEmptyAssembledTurn(), makeLog("1", "stdout", "前"));
    const first = applyLogToSegments(turn, makeLog("2", "stdout", "半", { segmentId: "main:s:1" }));
    // 模拟 updater 第二次调用（同 prev、同 input）
    const second = applyLogToSegments(turn, makeLog("2", "stdout", "半", { segmentId: "main:s:1" }));
    expect(second).toBe(first);
    expect(second.output).toBe("前半");
    // 真迟到重放（prev 已含该 log 内容）仍原引用返回（R-01 语义不变）
    expect(applyLogToSegments(first, makeLog("2", "stdout", "x", { segmentId: "main:s:1" }))).toBe(first);
    const third = applyLogToSegments(first, makeLog("3", "stdout", "截", { segmentId: "main:s:1" }));
    // 记忆为单槽：新 log 覆盖后，旧 logId 重放走集合命中（非记忆路径）
    expect(applyLogToSegments(third, makeLog("2", "stdout", "x", { segmentId: "main:s:1" }))).toBe(third);
  });

  it("撤回同步 id 索引：撤回后同 segmentId 新段 id 为派生 base（无多余 -2 后缀）", () => {
    let turn = applyLogToSegments(
      createEmptyAssembledTurn(),
      makeLog("1", "stdout", "p1", { segmentId: "main:a:1" }),
    );
    turn = applyLogToSegments(turn, makeLog("2", null, "[ASSISTANT_OVERRIDE] main:a:1"));
    expect(turn.segments).toHaveLength(0);
    turn = applyLogToSegments(turn, makeLog("3", "stdout", "p2", { segmentId: "main:a:1" }));
    // 索引已同步删除被撤 id：同 base 再建不带 -2（与全树收集语义一致）
    expect(turn.segments.map((s) => s.id)).toEqual(["text:main:a:1"]);
  });

  it("内部状态随对象展开流转：session-panel merge 形态（{...turn, ...next} + 视图直传）不断链", () => {
    const before = legacyProjectionBuildsForTest();
    let turn = applyLogToSegments(createEmptyAssembledTurn(), makeLog("1", "stdout", "首"));
    turn = applyLogToSegments(turn, makeLog("2", "stdout", "p1", { segmentId: "main:x:1" }));

    // 模拟 session-panel applyEnvelopeToTurn：视图构造（asAssembled 直传丢失 symbol）
    // + 转移内部状态 + {...turn, ...next} 展开回填
    const applyViaView = (t: AssembledTurn, log: AssemblerLogInput): AssembledTurn => {
      const view: AssembledTurn = {
        segments: t.segments,
        output: t.output,
        processItems: t.processItems,
        turnStartedAt: t.turnStartedAt,
        seenLogIds: t.seenLogIds,
      };
      transferAssemblerInternals(view, t);
      return { ...t, ...applyLogToSegments(view, log) };
    };

    for (let i = 3; i <= 50; i += 1) {
      turn = applyViaView(turn, makeLog(`${i}`, "stdout", "p", { segmentId: "main:x:1" }));
    }
    // 视图转移 + 展开流转后，partial 续接仍走增量（无逐条全量重投影）
    expect(legacyProjectionBuildsForTest() - before).toBeLessThanOrEqual(2);
    const full = segmentsToLegacy(turn.segments);
    expect(turn.output).toBe(full.output);
    expect(turn.processItems).toEqual(full.processItems);
  });

  it("历史批量路径（logsToSegments）与实时路径产出一致（增量不改变装配语义）", () => {
    const seq: AssemblerLogInput[] = [
      makeLog("1", "stdout", "正文一"),
      makeLog("2", "stdout", "正文二"),
      makeLog("3", "tool_call", TOOL_RAW),
      makeLog("4", "stdout", "[TOOL_RESULT] ok"),
      makeLog("5", null, "[THINKING] 思考"),
    ];
    let turn = createEmptyAssembledTurn();
    for (const log of seq) {
      turn = applyLogToSegments(turn, log);
    }
    expect(logsToSegments(seq)).toEqual(turn.segments);
    expect(turn.output).toBe(segmentsToLegacy(turn.segments).output);
  });
});
