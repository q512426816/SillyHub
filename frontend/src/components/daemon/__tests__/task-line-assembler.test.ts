/**
 * task-15（2026-08-27-background-subagent-progress / FR-03·07 前端半）：
 * 装配器 [TASK_*] 后台任务生命周期行单测（task-11 被测实现）。
 *
 * 覆盖（task 卡 implementation 逐条）：
 *   1. 分类解析——[TASK_STARTED] / [TASK_PROGRESS] / [TASK_NOTIFICATION] 前缀
 *      三行各自映射段元数据（taskStatus / taskElapsedMs / taskAsync /
 *      taskSummary / taskToolName，task_log_line_format 契约）；
 *   2. 日志序列装配——[TOOL_USE] 双发行丢弃 + tool_call JSON 建段 + 启动回执
 *      result 配对 + 三类 [TASK_*] 行按 parent_tool_use_id 路由写入派发 tool
 *      段元数据（PROGRESS 覆盖式刷新 elapsed / NOTIFICATION 终态覆盖 STARTED
 *      的 running；PROGRESS 不动状态——乱序迟到不复活）；
 *   3. 行本身不产正文段——[TASK_*] 消费后不显示为普通文本行，output /
 *      processItems 投影值与引用均不变（F7 增量链不断，元数据不入投影）；
 *   4. 坏 JSON 容错（R-07）——非 JSON / 非法 status 降级普通文本行不崩；
 *   5. 孤儿行丢弃——无 parent_tool_use_id / parent 无匹配 tool 段（含仅 stub
 *      的极端时序）→ 原引用返回不产段不崩；tool_call JSON 后续到达补写成功；
 *   6. 历史路径一致（logsToSegments）与实时逐条装配深度相等；重复行内容级
 *      去重且元数据写入幂等；
 *   7. 回归对拍——无 [TASK_*] 行的序列产出与既有断言口径一致（task-11 逻辑
 *      对无该方言的日志零影响）。
 *
 * 测试纪律对齐 session-log-assembler.test.ts：只走公开 API、不 mock 被测函数、
 * 每用例独立 fixture、断言真实段结构。
 */

import { describe, it, expect } from "vitest";

import {
  applyLogToSegments,
  classifySessionLog,
  createEmptyAssembledTurn,
  logsToSegments,
  segmentsToLegacy,
} from "../session-log-assembler";
import type {
  AssembledTurn,
  AssemblerLogInput,
  ToolTurnSegment,
  TurnSegment,
} from "../session-log-assembler";

/* ───────── 测试辅助（构造器对齐 session-log-assembler.test 惯例） ───────── */

function makeLog(
  id: string | null,
  channel: string | null,
  content: string,
  extra?: Partial<AssemblerLogInput>,
): AssemblerLogInput {
  return { logId: id, channel, content, timestamp: null, ...extra };
}

/** 逐条应用（实时 SSE 路径）到空 turn。 */
function applyAll(logs: AssemblerLogInput[]): AssembledTurn {
  return logs.reduce((turn, log) => applyLogToSegments(turn, log), createEmptyAssembledTurn());
}

/** DFS 全树找 id 匹配的 tool 段，找不到即测试失败。 */
function toolById(segments: TurnSegment[], id: string): ToolTurnSegment {
  const walk = (list: TurnSegment[]): ToolTurnSegment | null => {
    for (const s of list) {
      if (s.kind === "tool") {
        if (s.id === id) return s;
        const inner = walk(s.children);
        if (inner) return inner;
      } else if (s.kind === "subagent_stub") {
        const inner = walk(s.children);
        if (inner) return inner;
      }
    }
    return null;
  };
  const hit = walk(segments);
  if (!hit) throw new Error(`tool segment not found: ${id}`);
  return hit;
}

/** 后台任务派发工具（Task 工具 tool_call JSON，tool_use_id = tu_bg）。 */
const DISPATCH_RAW = JSON.stringify({
  tool: "Task",
  args: { description: "后台调研" },
  tool_use_id: "tu_bg",
  success: true,
});

const T0 = "2026-08-27T09:00:00.000Z";
const T1 = "2026-08-27T09:00:01.000Z";
const T2 = "2026-08-27T09:00:02.000Z";

/** [TASK_*] 行（daemon task-03 _writeTaskLine 落库形状：前缀 + 单行 JSON）。 */
function taskLine(
  prefix: "TASK_STARTED" | "TASK_PROGRESS" | "TASK_NOTIFICATION",
  json: string,
  extra?: Partial<AssemblerLogInput>,
): AssemblerLogInput {
  return makeLog(null, "stdout", `[${prefix}] ${json}`, {
    parentToolUseId: "tu_bg",
    ...extra,
  });
}

/* ───────── 1. 分类解析（classifySessionLog） ───────── */

describe("[TASK_*] 行分类（task-11 / FR-03·07）", () => {
  it("TASK_STARTED → taskStatus=running + taskAsync（async 布尔守卫）；text 留剥前缀 JSON 原文", () => {
    expect(classifySessionLog('[TASK_STARTED] {"task_id":"bg-1","async":true}', "stdout")).toEqual({
      kind: "task",
      text: '{"task_id":"bg-1","async":true}',
      taskStatus: "running",
      taskAsync: true,
    });
    // 旧数据 / 异常形态无 async 字段 → 只写 running，不写 taskAsync
    expect(classifySessionLog('[TASK_STARTED] {"task_id":"bg-1"}', "stdout")).toEqual({
      kind: "task",
      text: '{"task_id":"bg-1"}',
      taskStatus: "running",
    });
  });

  it("TASK_PROGRESS → taskElapsedMs / taskSummary / taskToolName（不动状态）", () => {
    expect(
      classifySessionLog(
        '[TASK_PROGRESS] {"elapsed_ms":1500,"summary":"跑测试中","last_tool_name":"Bash"}',
        "stdout",
      ),
    ).toEqual({
      kind: "task",
      text: '{"elapsed_ms":1500,"summary":"跑测试中","last_tool_name":"Bash"}',
      taskElapsedMs: 1500,
      taskSummary: "跑测试中",
      taskToolName: "Bash",
    });
    // 字段可选：仅 elapsed 的行不伪造其余字段
    expect(classifySessionLog('[TASK_PROGRESS] {"elapsed_ms":42}', "stdout")).toEqual({
      kind: "task",
      text: '{"elapsed_ms":42}',
      taskElapsedMs: 42,
    });
  });

  it("TASK_NOTIFICATION → 终态三值 + elapsedMs / summary（终态覆盖口径）", () => {
    expect(
      classifySessionLog(
        '[TASK_NOTIFICATION] {"status":"completed","elapsed_ms":45000,"summary":"全部通过"}',
        "stdout",
      ),
    ).toEqual({
      kind: "task",
      text: '{"status":"completed","elapsed_ms":45000,"summary":"全部通过"}',
      taskStatus: "completed",
      taskElapsedMs: 45_000,
      taskSummary: "全部通过",
    });
  });
});

/* ───────── 2+3. 序列装配：元数据写入 + 不产正文段 ───────── */

describe("[TASK_*] 序列装配（task-11 / FR-03·07：路由写入 tool 段元数据）", () => {
  it("全生命周期：STARTED→running+async；PROGRESS 覆盖式刷新 elapsed/summary/toolName；NOTIFICATION 终态覆盖", () => {
    // 派发上下文：[TOOL_USE] stdout 双发行丢弃（tool_call JSON 为权威源）+ 启动回执 result 配对
    let turn = applyAll([
      makeLog("1", "stdout", `[TOOL_USE] Task: ${DISPATCH_RAW}`),
      makeLog("2", "tool_call", DISPATCH_RAW, { timestamp: T0 }),
      makeLog("3", "stdout", "[TOOL_RESULT] 已在后台启动", { timestamp: T0 }),
    ]);
    const before = turn; // 启动回执配对后的基线

    // STARTED：写 running + async（R-04 行级 parent_tool_use_id 路由）
    turn = applyLogToSegments(turn, taskLine("TASK_STARTED", '{"task_id":"bg-1","async":true}', { timestamp: T0 }));
    let tool = toolById(turn.segments, "tu_bg");
    expect(tool.taskStatus).toBe("running");
    expect(tool.taskAsync).toBe(true);
    // 行本身不产正文段：段数不变、output 零贡献、投影引用稳定（F7 cell 复用）
    expect(turn.segments).toHaveLength(before.segments.length);
    expect(turn.output).toBe(before.output);
    expect(turn.processItems).toBe(before.processItems);

    // PROGRESS ①：elapsed / summary / toolName 写入，状态不动
    turn = applyLogToSegments(
      turn,
      taskLine("TASK_PROGRESS", '{"elapsed_ms":1500,"summary":"跑测试中","last_tool_name":"Bash"}', { timestamp: T1 }),
    );
    tool = toolById(turn.segments, "tu_bg");
    expect(tool).toMatchObject({
      taskStatus: "running",
      taskElapsedMs: 1500,
      taskSummary: "跑测试中",
      taskToolName: "Bash",
    });

    // PROGRESS ②：覆盖式刷新（服务端累计量只增，最新一条权威）
    turn = applyLogToSegments(
      turn,
      taskLine("TASK_PROGRESS", '{"elapsed_ms":4200,"summary":"修 bug 中","last_tool_name":"Edit"}', { timestamp: T1 }),
    );
    expect(toolById(turn.segments, "tu_bg")).toMatchObject({
      taskStatus: "running",
      taskElapsedMs: 4200,
      taskSummary: "修 bug 中",
      taskToolName: "Edit",
    });

    // NOTIFICATION：终态覆盖 STARTED 的 running + 权威用时 + 终态摘要
    turn = applyLogToSegments(
      turn,
      taskLine("TASK_NOTIFICATION", '{"status":"completed","elapsed_ms":45000,"summary":"全部通过"}', { timestamp: T2 }),
    );
    expect(toolById(turn.segments, "tu_bg")).toMatchObject({
      taskStatus: "completed",
      taskElapsedMs: 45_000,
      taskSummary: "全部通过",
    });
    // 全程不产正文段 / 投影零漂移（元数据不入 output 与 processItems）
    expect(turn.segments).toHaveLength(before.segments.length);
    expect(turn.output).toBe(before.output);
    expect(turn.processItems).toBe(before.processItems);
    const legacy = segmentsToLegacy(turn.segments);
    expect(legacy.output).toBe(before.output);
    expect(legacy.processItems).toEqual(before.processItems);
    // 启动回执 result 配对不受 [TASK_*] 行影响（async 0.1s 回执不是完成信号）
    expect(toolById(turn.segments, "tu_bg").result).toBe("已在后台启动");
  });

  it("乱序防御：NOTIFICATION 终态后迟到 PROGRESS 不复活状态（PROGRESS 不动 taskStatus），时长照常刷新", () => {
    let turn = applyAll([
      makeLog("1", "tool_call", DISPATCH_RAW),
      taskLine("TASK_STARTED", '{"async":true}'),
      taskLine("TASK_NOTIFICATION", '{"status":"failed","elapsed_ms":9000,"summary":"崩了"}'),
    ]);
    turn = applyLogToSegments(
      turn,
      taskLine("TASK_PROGRESS", '{"elapsed_ms":9800,"summary":"迟到心跳","last_tool_name":"Bash"}'),
    );
    expect(toolById(turn.segments, "tu_bg")).toMatchObject({
      taskStatus: "failed", // 终态即终，迟到进行中行不覆盖
      taskElapsedMs: 9800, // 到达顺序即权威，最新 elapsed 刷新
      taskSummary: "迟到心跳",
      taskToolName: "Bash",
    });
  });

  it("嵌套路由：parent 指向 children 内 tool 段（DFS 容器定位）同样写入", () => {
    let turn = applyAll([
      makeLog("1", "tool_call", DISPATCH_RAW),
      makeLog(
        "2",
        "tool_call",
        '{"tool":"Task","args":{"description":"孙任务"},"tool_use_id":"tu_inner","success":true}',
        { parentToolUseId: "tu_bg", subagentType: "researcher" },
      ),
    ]);
    turn = applyLogToSegments(
      turn,
      makeLog("3", "stdout", '[TASK_NOTIFICATION] {"status":"completed","elapsed_ms":1000}', {
        parentToolUseId: "tu_inner",
      }),
    );
    expect(toolById(turn.segments, "tu_inner").taskStatus).toBe("completed");
    expect(toolById(turn.segments, "tu_bg").taskStatus).toBeUndefined(); // 不误伤外层
  });

  it("turnStartedAt 兜底：live/attach 锚点均缺时取 [TASK_*] 行 timestamp（§7.5 同主路径）", () => {
    let turn = applyAll([makeLog("1", "tool_call", DISPATCH_RAW)]); // 无 timestamp → 锚点仍 null
    expect(turn.turnStartedAt).toBeNull();
    turn = applyLogToSegments(
      turn,
      taskLine("TASK_STARTED", '{"async":true}', { timestamp: T0 }),
    );
    expect(turn.turnStartedAt).toBe(Date.parse(T0));
  });
});

/* ───────── 4. 坏 JSON 容错（R-07） ───────── */

describe("[TASK_*] 坏行容错（task-11 / R-07：降级文本不崩）", () => {
  it("非 JSON 的 [TASK_PROGRESS] → 降级普通 reply 文本行（原文保留），装配不崩", () => {
    // parseTaskLine 返回 null 落到 reply 分支——reply 前缀剥取不含 [TASK_*]，
    // 降级行保留整行原文（宁进正文不丢内容）
    expect(classifySessionLog("[TASK_PROGRESS] not-json", "stdout")).toEqual({
      kind: "reply",
      text: "[TASK_PROGRESS] not-json",
    });
    // 装配路径：降级行按归属路由进派发 tool 段 children 成为文本段
    const turn = applyAll([
      makeLog("1", "tool_call", DISPATCH_RAW),
      taskLine("TASK_PROGRESS", "not-json"),
    ]);
    const tool = toolById(turn.segments, "tu_bg");
    expect(tool.taskStatus).toBeUndefined(); // 坏行不写元数据
    expect(tool.children.map((s) => s.kind)).toEqual(["text"]);
    expect(turn.output).toBe("[TASK_PROGRESS] not-json");
  });

  it("TASK_NOTIFICATION 非法 status（非三值终态）→ 视为坏行降级 reply 文本（原文保留）", () => {
    const bad = '[TASK_NOTIFICATION] {"status":"weird","elapsed_ms":1}';
    expect(classifySessionLog(bad, "stdout")).toEqual({ kind: "reply", text: bad });
  });

  it("[TASK_STARTED] 非 JSON / JSON 原始值（非对象）同样降级 reply", () => {
    expect(classifySessionLog("[TASK_STARTED] 启动了", "stdout")).toEqual({
      kind: "reply",
      text: "[TASK_STARTED] 启动了",
    });
    // JSON 数字是合法 JSON 但非对象载荷 → 守卫拦截降级（数组 typeof "object"
    // 会通过守卫成为 task 段，属退化形态非坏行——不在降级口径内）
    expect(classifySessionLog("[TASK_STARTED] 42", "stdout")).toEqual({
      kind: "reply",
      text: "[TASK_STARTED] 42",
    });
  });
});

/* ───────── 5. 孤儿行丢弃（无 parent / 无匹配段） ───────── */

describe("[TASK_*] 孤儿行丢弃（task-11：找不到段不崩，不建 stub 空壳）", () => {
  it("无 parent_tool_use_id → 原引用返回，不产任何段（含不落顶层文本）", () => {
    const turn = applyAll([makeLog("1", "tool_call", DISPATCH_RAW)]);
    const after = applyLogToSegments(
      turn,
      makeLog("2", "stdout", '[TASK_NOTIFICATION] {"status":"completed","elapsed_ms":1}'),
    );
    expect(after).toBe(turn); // 原引用返回
    expect(toolById(after.segments, "tu_bg").taskStatus).toBeUndefined();
  });

  it("parent 指向不存在的 tool_use_id → 丢弃原引用返回", () => {
    const turn = applyAll([makeLog("1", "tool_call", DISPATCH_RAW)]);
    const after = applyLogToSegments(
      turn,
      makeLog("2", "stdout", '[TASK_STARTED] {"async":true}', { parentToolUseId: "tu_ghost" }),
    );
    expect(after).toBe(turn);
    // 不为 [TASK_*] 行建 subagent_stub 兜底段（取更安全者）
    expect(after.segments).toHaveLength(1);
  });

  it("parent 仅为 stub 的极端时序（子消息先到、tool_call JSON 未到）→ 丢弃；tool 段到达后后续行补写成功", () => {
    let turn = applyAll([
      makeLog("1", "stdout", "子消息先到", { parentToolUseId: "tu_bg", subagentType: "researcher" }),
    ]);
    // stub 无元数据槽 → 行丢弃（原引用返回）
    const dropped = applyLogToSegments(
      turn,
      taskLine("TASK_STARTED", '{"async":true}'),
    );
    expect(dropped).toBe(turn);
    // tool_call JSON 到达合并 stub 后，后续 [TASK_*] 行补写元数据
    turn = applyAll([
      ...[makeLog("1", "stdout", "子消息先到", { parentToolUseId: "tu_bg", subagentType: "researcher" })],
      makeLog("2", "tool_call", DISPATCH_RAW),
      taskLine("TASK_NOTIFICATION", '{"status":"stopped","elapsed_ms":7000}'),
    ]);
    expect(toolById(turn.segments, "tu_bg")).toMatchObject({
      taskStatus: "stopped",
      taskElapsedMs: 7000,
      subagentType: "researcher", // stub 的 children / subagentType 随迁不受影响
    });
  });
});

/* ───────── 6. 历史路径一致 + 去重幂等 ───────── */

describe("[TASK_*] 历史路径（logsToSegments 与实时同一装配语义）", () => {
  const FULL_SEQUENCE: AssemblerLogInput[] = [
    makeLog("1", "stdout", `[TOOL_USE] Task: ${DISPATCH_RAW}`),
    makeLog("2", "tool_call", DISPATCH_RAW, { timestamp: T0 }),
    makeLog("3", "stdout", "[TOOL_RESULT] 已在后台启动", { timestamp: T0 }),
    makeLog("4", "stdout", '[TASK_STARTED] {"task_id":"bg-1","async":true}', { parentToolUseId: "tu_bg", timestamp: T0 }),
    makeLog("5", "stdout", '[TASK_PROGRESS] {"elapsed_ms":1500,"summary":"跑测试中","last_tool_name":"Bash"}', { parentToolUseId: "tu_bg", timestamp: T1 }),
    makeLog("6", "stdout", '[TASK_NOTIFICATION] {"status":"completed","elapsed_ms":45000,"summary":"全部通过"}', { parentToolUseId: "tu_bg", timestamp: T2 }),
  ];

  it("同一序列：历史批量与实时逐条产出深度相等（元数据含内）", () => {
    expect(logsToSegments(FULL_SEQUENCE)).toEqual(applyAll(FULL_SEQUENCE).segments);
  });

  it("重复 [TASK_PROGRESS] 行（重放）：内容级去重 + 元数据写入幂等，产出与无重复序列一致", () => {
    const dupLine: AssemblerLogInput = makeLog(
      "5b",
      "stdout",
      '[TASK_PROGRESS] {"elapsed_ms":1500,"summary":"跑测试中","last_tool_name":"Bash"}',
      { parentToolUseId: "tu_bg", timestamp: T1 },
    );
    // 序列中插入一条与 log5 完全同内容的重放行
    const withDup = [...FULL_SEQUENCE.slice(0, 5), dupLine, ...FULL_SEQUENCE.slice(5)];
    expect(logsToSegments(withDup)).toEqual(logsToSegments(FULL_SEQUENCE));
  });
});

/* ───────── 7. 回归对拍：无 [TASK_*] 行的序列零影响 ───────── */

describe("无 [TASK_*] 序列回归对拍（task-11 对既有日志零影响）", () => {
  it("经典序列产出与既有断言口径一致（分段 / 配对 / 投影）", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "前文"),
      makeLog("2", "tool_call", DISPATCH_RAW),
      makeLog("3", "stdout", "后文"),
      makeLog("4", "stdout", "[TOOL_RESULT] 调研结论"),
    ]);
    // 对拍 session-log-assembler.test「reply 被 tool_use 打断开新 text 段」同款口径
    expect(turn.segments.map((s) => s.kind)).toEqual(["text", "tool", "text"]);
    expect(turn.output).toBe("前文后文");
    expect(toolById(turn.segments, "tu_bg").result).toBe("调研结论");
    expect(turn.processItems).toHaveLength(1); // 仅 tool 项（text 走 output 拼接）
  });

  it("孤儿 [TASK_*] 行夹在正常序列中 → 整体产出与无该行完全一致（深比较）", () => {
    const base = [
      makeLog("1", "stdout", "前文"),
      makeLog("2", "tool_call", DISPATCH_RAW),
      makeLog("3", "stdout", "后文"),
    ];
    const withOrphan = [
      base[0]!,
      base[1]!,
      // 无 parent 的孤儿生命周期行（历史脏数据）
      makeLog("x", "stdout", '[TASK_NOTIFICATION] {"status":"completed","elapsed_ms":1}'),
      base[2]!,
    ];
    expect(applyAll(withOrphan).segments).toEqual(applyAll(base).segments);
    expect(applyAll(withOrphan).output).toBe("前文后文");
  });
});
