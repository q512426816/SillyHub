/**
 * 2026-08-19-session-stream-ux / task-03：共享装配器纯函数单测（行为规格）。
 *
 * 只走公开 API（applyLogToSegments / logsToSegments / segmentsToLegacy / finishTurn /
 * createEmptyAssembledTurn）断言段结构形状，不 mock 被测函数、不 mock 网络/React/定时器。
 * 用例分组（task 卡 acceptance 逐条覆盖）：
 *   1. 分段（FR-01）：连续 reply 续接同段 / 被非文本段打断开新段 / 连续 thinking \n 合并；
 *   2. 归属嵌套（FR-03）：parent_tool_use_id 路由进 tool 段 children + depth>1 递归；
 *   3. override 撤回（R-06 / Grill X-06）：两前缀 × 两 variant + 跨段撤回 + no-op；
 *   4. 归属桶配对（Grill X-02）：同桶最后未配对配对、主/子交错不误配 + R-07 容错；
 *   5. 兜底 stub（R-02 / §9.5）：子先到建 stub / tool 段到达迁入合并 / 父缺失保留平铺；
 *   6. 双路去重（R-01 / Grill X-08）：SSE log_id 与历史 seenText 两路独立不合并；
 *   7. 历史与实时一致性（§9.1 / §9.4）：增量 vs 批量深度相等 + 投影 ts 映射；
 *   8. streaming（§5 Phase3）：置位 / 撤回随段清除 / finishTurn 全树清除。
 *   9. FileUpload 文件段（task-08 / 2026-08-23-agent-file-upload-mcp / FR-01 /
 *      design §7.3）：FileUpload 行 → file 段且不再产 tool_use 段 / 坏 JSON 回退
 *      通用映射 / 未知 tool_kind 策略保持 / 投影跳过 / 两路去重不受影响。
 *  10. 技能装载注入行（ql-20260824-017）：[ASSISTANT] Base directory 前缀行归
 *      kind=skill 挂最近 Skill 工具段 result（不进对话正文）/ 多次装载不串段 /
 *      子代理桶路由 / 无 Skill 段退化文本段 / 历史路径一致。
 */

import { describe, it, expect } from "vitest";

import {
  applyLogToSegments,
  classifySessionLog,
  createEmptyAssembledTurn,
  extractPreambleText,
  finishTurn,
  logsToSegments,
  segmentsToLegacy,
} from "../session-log-assembler";
import type {
  AssembledTurn,
  AssemblerLogInput,
  ToolTurnSegment,
  TurnSegment,
} from "../session-log-assembler";

type TextTurnSegment = Extract<TurnSegment, { kind: "text" }>;
type ThinkingTurnSegment = Extract<TurnSegment, { kind: "thinking" }>;

/* ───────── 测试辅助（每个用例独立 fixture；构造器模式对齐 runtime-session-helpers.test） ───────── */

/** 构造归一化日志输入（SSE envelope 与历史 log 的统一形状）。extra 覆盖归属三字段等可选项。 */
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

/** DFS 全树找首个命中段（断言真实段结构用，不依赖被测文件内部函数）。 */
function findSeg(
  segments: TurnSegment[],
  pred: (_s: TurnSegment) => boolean,
): TurnSegment | undefined {
  for (const s of segments) {
    if (pred(s)) return s;
    if (s.kind === "tool" || s.kind === "subagent_stub") {
      const inner = findSeg(s.children, pred);
      if (inner) return inner;
    }
  }
  return undefined;
}

function expectText(s: TurnSegment | undefined): TextTurnSegment {
  if (!s || s.kind !== "text") throw new Error(`expected text segment, got ${s?.kind ?? "none"}`);
  return s;
}

function expectThinking(s: TurnSegment | undefined): ThinkingTurnSegment {
  if (!s || s.kind !== "thinking") {
    throw new Error(`expected thinking segment, got ${s?.kind ?? "none"}`);
  }
  return s;
}

function expectTool(s: TurnSegment | undefined): ToolTurnSegment {
  if (!s || s.kind !== "tool") throw new Error(`expected tool segment, got ${s?.kind ?? "none"}`);
  return s;
}

/** DFS 找 id 匹配的 tool 段（嵌套 children 一并搜），找不到即测试失败。 */
function toolById(segments: TurnSegment[], id: string): ToolTurnSegment {
  return expectTool(findSeg(segments, (s) => s.kind === "tool" && s.id === id));
}

/* ───────── 1. 分段（FR-01） ───────── */

describe("分段（FR-01：续接 / 打断 / thinking 合并）", () => {
  it("连续 reply 续接同段（无分隔符直拼，同 legacy output concat 语义）", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "你好"),
      makeLog("2", "stdout", "，世界"),
      makeLog("3", "stdout", "！"),
    ]);
    expect(turn.segments).toEqual([
      { kind: "text", id: "text:1", text: "你好，世界！", streaming: false, startedAt: null },
    ]);
    expect(turn.output).toBe("你好，世界！");
  });

  it("reply 被 tool_use 打断开新 text 段；多段文本投影按序拼接等价单串", () => {
    const raw = '{"tool":"Read","args":{"file_path":"a.ts"},"tool_use_id":"tu_a","success":true}';
    const turn = applyAll([
      makeLog("1", "stdout", "前文"),
      makeLog("2", "tool_call", raw),
      makeLog("3", "stdout", "后文"),
    ]);
    expect(turn.segments.map((s) => s.kind)).toEqual(["text", "tool", "text"]);
    const first = expectText(turn.segments[0]);
    const second = expectText(turn.segments[2]);
    expect(first.text).toBe("前文");
    expect(second.text).toBe("后文");
    // 打断后是不同段（段 id 按段唯一，R-06 跨段撤回依赖）
    expect(first.id).not.toBe(second.id);
    const tool = expectTool(turn.segments[1]);
    expect(tool.id).toBe("tu_a");
    expect(tool.toolName).toBe("Read");
    expect(tool.primary).toBe("a.ts");
    expect(tool.status).toBe("ok");
    // 投影：多段文本按序拼接，与单串 concat 结果等价（§9.4）
    expect(turn.output).toBe("前文后文");
  });

  it("reply 被 stderr 打断同样开新段（任何非同类段都打断）", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "前"),
      makeLog("2", "stderr", "warn"),
      makeLog("3", "stdout", "后"),
    ]);
    expect(turn.segments.map((s) => s.kind)).toEqual(["text", "stderr", "text"]);
    expect(turn.output).toBe("前后");
    expect(turn.processItems).toEqual([{ kind: "stderr", text: "warn" }]);
  });

  it("连续 thinking 合并为一项（\\n 连接，同 TurnDetailsList 连续思考合并格式）", () => {
    const turn = applyAll([
      makeLog("1", null, "[THINKING] 先想想"),
      makeLog("2", null, "[THINKING] 再想想"),
      makeLog("3", null, "[THINKING] 又想想"),
    ]);
    expect(turn.segments).toEqual([
      { kind: "thinking", id: "thinking:1", text: "先想想\n再想想\n又想想", streaming: false, ts: null },
    ]);
    expect(turn.processItems).toEqual([{ kind: "thinking", text: "先想想\n再想想\n又想想" }]);
  });

  it("thinking 被打断分段，投影出两个独立思考项（保持到达顺序不混）", () => {
    const raw = '{"tool":"Bash","args":{"command":"ls"},"tool_use_id":"tu_b","success":true}';
    const turn = applyAll([
      makeLog("1", null, "[THINKING] 思考A"),
      makeLog("2", "tool_call", raw),
      makeLog("3", null, "[THINKING] 思考B"),
    ]);
    expect(turn.segments.map((s) => s.kind)).toEqual(["thinking", "tool", "thinking"]);
    expect(turn.processItems).toEqual([
      { kind: "thinking", text: "思考A" },
      { kind: "tool", raw, status: "ok" },
      { kind: "thinking", text: "思考B" },
    ]);
  });
});

/* ───────── 2. 归属嵌套（FR-03） ───────── */

describe("归属嵌套（FR-03：parent_tool_use_id 路由）", () => {
  it("子代理消息按 parent_tool_use_id 路由进 tool 段 children；主消息仍顶层平铺", () => {
    const raw = '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_task","success":true}';
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", null, "[THINKING] 子思考", { parentToolUseId: "tu_task", subagentType: "researcher" }),
      makeLog("3", "stdout", "子代理结论", { parentToolUseId: "tu_task", subagentType: "researcher" }),
      makeLog("4", "stdout", "主答复"),
    ]);
    expect(turn.segments).toHaveLength(2);
    const tool = expectTool(turn.segments[0]);
    expect(tool.subagentType).toBe("researcher");
    expect(tool.children).toEqual([
      { kind: "thinking", id: "thinking:2", text: "子思考", streaming: false, ts: null },
      { kind: "text", id: "text:3", text: "子代理结论", streaming: false, startedAt: null },
    ]);
    expect(expectText(turn.segments[1])).toEqual({
      kind: "text", id: "text:4", text: "主答复", streaming: false, startedAt: null,
    });
    // 投影（§9.1 等价）：output 含子代理 reply（DFS 序），子思考平铺进 processItems
    expect(turn.output).toBe("子代理结论主答复");
    expect(turn.processItems).toEqual([
      { kind: "tool", raw, status: "ok" },
      { kind: "thinking", text: "子思考" },
    ]);
  });

  it("depth>1 递归嵌套：parentToolUseId 指向 children 内 tool 段 id（子内再嵌孙）", () => {
    const turn = applyAll([
      makeLog("1", "tool_call", '{"tool":"Task","args":{"description":"父任务"},"tool_use_id":"tu_p","success":true}'),
      makeLog(
        "2",
        "tool_call",
        '{"tool":"Task","args":{"description":"子任务"},"tool_use_id":"tu_c","success":true}',
        { parentToolUseId: "tu_p", subagentType: "researcher" },
      ),
      makeLog("3", "stdout", "孙辈消息", { parentToolUseId: "tu_c", subagentType: "writer", depth: 2 }),
    ]);
    const outer = toolById(turn.segments, "tu_p");
    expect(outer.subagentType).toBe("researcher");
    const inner = toolById(outer.children, "tu_c");
    // 嵌套关系由 parent 链表达（不依赖 depth 字段）；容器补记子代理目录信息
    expect(inner.subagentType).toBe("writer");
    expect(inner.children).toEqual([
      { kind: "text", id: "text:3", text: "孙辈消息", streaming: false, startedAt: null },
    ]);
    // 投影 DFS：父 tool → 子 tool（先自身项再 children）
    expect(turn.processItems.map((p) => p.kind)).toEqual(["tool", "tool"]);
  });
});

/* ───────── 3. override 撤回（R-06 / Grill X-06） ───────── */

describe("override 撤回（R-06：前缀路由 × variant × 跨段撤回）", () => {
  it("main 前缀 × assistant：partial 被工具段打断分裂多段后 override 到达 → 全部派生段移除，output 投影同步", () => {
    const raw = '{"tool":"Bash","args":{"command":"ls"},"tool_use_id":"tu_x","success":true}';
    const turn = applyAll([
      makeLog("1", "stdout", "保留整段"),
      makeLog("2", "stdout", "partial-A", { segmentId: "main:msg_1:1" }),
      makeLog("3", "tool_call", raw),
      makeLog("4", "stdout", "partial-B", { segmentId: "main:msg_1:1" }),
    ]);
    // 同一 segmentId 的 partial 被工具段打断 → 分裂为基段 + -2 后缀派生段（R-06 段模型形态）
    expect(turn.segments.map((s) => s.id)).toEqual([
      "text:1",
      "text:main:msg_1:1",
      "tu_x",
      "text:main:msg_1:1-2",
    ]);
    expect(turn.output).toBe("保留整段partial-Apartial-B");
    const after = applyLogToSegments(turn, makeLog("5", null, "[ASSISTANT_OVERRIDE] main:msg_1:1"));
    // 跨段撤回：该 segmentId 的全部派生段一并移除——段模型等价 legacy 单串截断语义
    // （该 partial 对 output 的全部贡献被截断，前后他段文本保留）
    expect(after.segments.map((s) => s.id)).toEqual(["text:1", "tu_x"]);
    expect(after.output).toBe("保留整段");
    // 未触及段引用稳定（path-copy，FR-06）
    expect(after.segments[0]).toBe(turn.segments[0]);
    expect(after.segments[1]).toBe(turn.segments[2]);
  });

  it("异源段交错：partial 续接纯度（不与其它 segmentId 续接）→ 派生链分裂，撤回只命中本链", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "m1-a", { segmentId: "main:m1:1" }),
      makeLog("2", "stdout", "m2-a", { segmentId: "main:m2:1" }),
      makeLog("3", "stdout", "m1-b", { segmentId: "main:m1:1" }),
    ]);
    // m1 的 partial 不与异源段（m2）续接 → 交错分裂出 m1 的 -2 派生段
    expect(turn.segments.map((s) => s.id)).toEqual([
      "text:main:m1:1",
      "text:main:m2:1",
      "text:main:m1:1-2",
    ]);
    const after = applyLogToSegments(turn, makeLog("4", null, "[ASSISTANT_OVERRIDE] main:m1:1"));
    // 跨段撤回只命中 m1 的派生链（基段 + -2），m2 保留
    expect(after.segments.map((s) => s.id)).toEqual(["text:main:m2:1"]);
    expect(after.output).toBe("m2-a");
  });

  it("main 前缀 × thinking：撤回思考段（思考项移除语义），跨段派生一并移除", () => {
    const raw = '{"tool":"Read","args":{"file_path":"a.ts"},"tool_use_id":"tu_y","success":true}';
    const turn = applyAll([
      makeLog("1", null, "[THINKING] 撤掉的思考", { segmentId: "main:msg_9:2" }),
      makeLog("2", "tool_call", raw),
      makeLog("3", null, "[THINKING] 保留的思考"),
      makeLog("4", null, "[THINKING] 续接保留"),
    ]);
    expect(turn.processItems.map((p) => p.kind)).toEqual(["thinking", "tool", "thinking"]);
    const after = applyLogToSegments(turn, makeLog("5", null, "[THINKING_OVERRIDE] main:msg_9:2"));
    expect(after.segments.map((s) => s.kind)).toEqual(["tool", "thinking"]);
    expect(after.output).toBe("");
    expect(after.processItems).toEqual([
      { kind: "tool", raw, status: "ok" },
      { kind: "thinking", text: "保留的思考\n续接保留" },
    ]);
  });

  it("tool_use_id 前缀 × thinking：撤回路由进 tool 段 children 内的 partial 思考", () => {
    const raw = '{"tool":"Task","args":{"description":"子代理"},"tool_use_id":"tu_t","success":true}';
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", null, "[THINKING] 子思考partial", { parentToolUseId: "tu_t", segmentId: "tu_t:2" }),
      makeLog("3", "stdout", "子正文", { parentToolUseId: "tu_t" }),
      makeLog("4", null, "[THINKING] 保留子思考", { parentToolUseId: "tu_t" }),
    ]);
    // 撤回前：partial 思考段 streaming 已置位（带 segmentId 追加，§5 Phase3）
    expect(expectThinking(findSeg(turn.segments, (s) => s.id === "thinking:tu_t:2")).streaming).toBe(true);
    const after = applyLogToSegments(turn, makeLog("5", null, "[THINKING_OVERRIDE] tu_t:2"));
    const tool = expectTool(after.segments[0]);
    expect(tool.children.map((s) => s.kind)).toEqual(["text", "thinking"]);
    expect(after.output).toBe("子正文");
    expect(after.processItems).toEqual([
      { kind: "tool", raw, status: "ok" },
      { kind: "thinking", text: "保留子思考" },
    ]);
  });

  it("tool_use_id 前缀 × assistant：撤回 tool 段 children 内分裂的 partial 文本（投影同步）", () => {
    const raw = '{"tool":"Task","args":{"description":"子代理"},"tool_use_id":"tu_t2","success":true}';
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", "stdout", "sub-a", { parentToolUseId: "tu_t2", segmentId: "tu_t2:1" }),
      makeLog("3", "stderr", "子代理告警", { parentToolUseId: "tu_t2" }),
      makeLog("4", "stdout", "sub-b", { parentToolUseId: "tu_t2", segmentId: "tu_t2:1" }),
    ]);
    expect(turn.output).toBe("sub-asub-b");
    const after = applyLogToSegments(turn, makeLog("5", null, "[ASSISTANT_OVERRIDE] tu_t2:1"));
    expect(after.segments).toHaveLength(1);
    const tool = expectTool(after.segments[0]);
    expect(tool.children.map((s) => s.kind)).toEqual(["stderr"]);
    // 子代理 partial 文本贡献从 output 一并截断（投影同步）
    expect(after.output).toBe("");
  });

  it("no-op：未知 segmentId / 未知容器前缀 / kind 不匹配 → 原引用返回（对齐 Map 未命中即 return）", () => {
    const turn = applyAll([makeLog("1", "stdout", "正文")]);
    // 顶层无该 segmentId 派生段
    expect(applyLogToSegments(turn, makeLog("2", null, "[ASSISTANT_OVERRIDE] main:ghost:9"))).toBe(turn);
    // 树内无 tu_none 容器
    expect(applyLogToSegments(turn, makeLog("3", null, "[THINKING_OVERRIDE] tu_none:1"))).toBe(turn);
    // 撤 thinking 但只有 text 段（variant 决定撤回 kind）
    expect(applyLogToSegments(turn, makeLog("4", null, "[THINKING_OVERRIDE] main:1"))).toBe(turn);
  });
});

/* ───────── 4. 归属桶配对（Grill X-02）与 tool 段容错（R-07） ───────── */

describe("归属桶配对（Grill X-02：同桶最后未配对，不跨桶误配）", () => {
  it("tool_result 只配对同桶（parentToolUseId 相同）最后未配对 tool 段；主/子工具交错不误配", () => {
    const tuARaw = '{"tool":"Read","args":{"file_path":"a.ts"},"tool_use_id":"tu_A","success":true}';
    const tuPRaw = '{"tool":"Task","args":{"description":"子代理"},"tool_use_id":"tu_P","success":true}';
    const tuSRaw = '{"tool":"Bash","args":{"command":"ls"},"tool_use_id":"tu_S","success":true}';
    const ts4 = "2026-08-19T10:00:04.000Z";
    let turn = createEmptyAssembledTurn();
    for (const log of [
      makeLog("1", "tool_call", tuARaw),
      makeLog("2", "tool_call", tuPRaw),
      makeLog("3", "tool_call", tuSRaw, { parentToolUseId: "tu_P" }),
    ]) {
      turn = applyLogToSegments(turn, log);
    }
    // 子桶 result：只配对 tu_P 桶内最后未配对的 tu_S——主级 tu_A / tu_P 不被跨桶误配
    turn = applyLogToSegments(
      turn,
      makeLog("4", "stdout", "[TOOL_RESULT] 子工具结果", { parentToolUseId: "tu_P", timestamp: ts4 }),
    );
    expect(toolById(turn.segments, "tu_A").result).toBeUndefined();
    expect(toolById(turn.segments, "tu_P").result).toBeUndefined();
    expect(toolById(turn.segments, "tu_S")).toEqual({
      kind: "tool",
      id: "tu_S",
      raw: tuSRaw,
      result: "子工具结果",
      status: "ok",
      toolName: "Bash",
      primary: "ls",
      startedAt: null,
      endedAt: Date.parse(ts4),
      children: [],
      subagentType: null,
    });
    // 主级 result 交错到达：配对主级最后未配对的 tu_P（不跳配 tu_A、不误入子桶）
    turn = applyLogToSegments(turn, makeLog("5", "stdout", "[TOOL_RESULT] 任务结果"));
    expect(toolById(turn.segments, "tu_P").result).toBe("任务结果");
    expect(toolById(turn.segments, "tu_A").result).toBeUndefined();
    turn = applyLogToSegments(turn, makeLog("6", "stdout", "[TOOL_RESULT] 文件内容"));
    expect(toolById(turn.segments, "tu_A").result).toBe("文件内容");
    // 子桶已配对的 tu_S 不被主级 result 覆盖
    expect(toolById(turn.segments, "tu_S").result).toBe("子工具结果");
  });

  it("桶内孤儿 result（桶内无未配对 tool）→ raw 空 tool 段兜底落在桶内，不上浮主级", () => {
    const raw = '{"tool":"Task","args":{"description":"子代理"},"tool_use_id":"tu_orp","success":true}';
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", "stdout", "[TOOL_RESULT] 桶内孤儿", { parentToolUseId: "tu_orp" }),
    ]);
    expect(turn.segments).toHaveLength(1);
    const tool = expectTool(turn.segments[0]);
    expect(tool.children).toHaveLength(1);
    expect(tool.children[0]).toEqual({
      kind: "tool",
      id: "tool:2",
      raw: "",
      result: "桶内孤儿",
      status: "ok",
      toolName: null,
      primary: null,
      startedAt: null,
      endedAt: null,
      children: [],
      subagentType: null,
    });
  });

  it("ql-20260824-020：tool_result 携带 editPatch 随配对写入 tool 段（孤儿段同）；无则 undefined", () => {
    const raw =
      '{"tool":"Edit","args":{"file_path":"a.ts","old_string":"x","new_string":"y"},"tool_use_id":"tu_E","success":true}';
    const patch = JSON.stringify([
      { oldStart: 55, newStart: 55, oldLines: 1, newLines: 1, lines: ["-x", "+y"] },
    ]);
    // 配对分支：editPatch 落到配对的 tool 段
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", "stdout", "[TOOL_RESULT] The file a.ts has been updated", {
        editPatch: patch,
      }),
    ]);
    expect(toolById(turn.segments, "tu_E").editPatch).toBe(patch);
    // 孤儿分支：桶内无未配对 tool 时兜底段同样携带
    const orphanTurn = applyAll([
      makeLog("1", "stdout", "[TOOL_RESULT] 孤儿 Edit 结果", { editPatch: patch }),
    ]);
    expect(expectTool(orphanTurn.segments[0]).editPatch).toBe(patch);
    // 无 editPatch 的普通结果：段上保持 undefined（不污染其他工具）
    const plain = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", "stdout", "[TOOL_RESULT] The file a.ts has been updated"),
    ]);
    expect(toolById(plain.segments, "tu_E").editPatch).toBeUndefined();
  });

  it("tool_call 非 JSON（R-07 容错）：id 退 logId 派生、toolName=null 原样 raw、status running 靠 result 配对兜底", () => {
    const turn = applyAll([
      makeLog("1", "tool_call", "Read a.ts"),
      makeLog("2", "stdout", "[TOOL_RESULT] 文件内容"),
    ]);
    expect(turn.segments).toEqual([
      {
        kind: "tool",
        id: "tool:1",
        raw: "Read a.ts",
        result: "文件内容",
        status: "ok",
        toolName: null,
        primary: null,
        startedAt: null,
        endedAt: null,
        children: [],
        subagentType: null,
      },
    ]);
  });
});

/* ───────── 5. 兜底 stub（R-02 / §9.5） ───────── */

describe("兜底 stub（R-02：子先到 / 迁入合并 / 父缺失平铺）", () => {
  it("子消息先到（无匹配 tool 段）→ 顶层建立 subagent_stub 容纳", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "子消息先到", { parentToolUseId: "tu_late", subagentType: "researcher" }),
    ]);
    expect(turn.segments).toEqual([
      {
        kind: "subagent_stub",
        id: "tu_late",
        subagentType: "researcher",
        children: [
          { kind: "text", id: "text:1", text: "子消息先到", streaming: false, startedAt: null },
        ],
      },
    ]);
    // 投影平铺：stub 只展开 children（legacy 无 stub 概念）
    expect(turn.output).toBe("子消息先到");
  });

  it("后续 tool_use 到达且 id 匹配 → stub 移除、children / subagentType 随迁 tool 段", () => {
    const raw = '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_late","success":true}';
    const turn = applyAll([
      makeLog("1", "stdout", "子消息先到", { parentToolUseId: "tu_late", subagentType: "researcher" }),
      makeLog("2", "stdout", "子补充", { parentToolUseId: "tu_late" }),
      makeLog("3", "tool_call", raw),
      makeLog("4", "stdout", "主答复"),
    ]);
    // stub 已移除（树内只剩 tool + 主文本）；stub 内连续文本已续接合并
    expect(turn.segments.map((s) => s.kind)).toEqual(["tool", "text"]);
    const tool = expectTool(turn.segments[0]);
    expect(tool.id).toBe("tu_late");
    expect(tool.subagentType).toBe("researcher");
    expect(tool.children).toEqual([
      { kind: "text", id: "text:1", text: "子消息先到子补充", streaming: false, startedAt: null },
    ]);
    expect(turn.output).toBe("子消息先到子补充主答复");
  });

  it("父 tool_use 永缺失 → stub 保留顶层平铺位置，后续主消息接在其后", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "子消息", { parentToolUseId: "tu_gone", subagentType: "researcher" }),
      makeLog("2", "stdout", "主答复"),
    ]);
    expect(turn.segments).toEqual([
      {
        kind: "subagent_stub",
        id: "tu_gone",
        subagentType: "researcher",
        children: [
          { kind: "text", id: "text:1", text: "子消息", streaming: false, startedAt: null },
        ],
      },
      { kind: "text", id: "text:2", text: "主答复", streaming: false, startedAt: null },
    ]);
    expect(turn.output).toBe("子消息主答复");
  });
});

/* ───────── 6. 双路去重（R-01 / Grill X-08） ───────── */

describe("双路去重（R-01 log_id 与 Grill X-08 seenText 两路独立不合并）", () => {
  it("SSE 路径：重复 log_id 原引用返回（R-01 重连 / 事件重放）", () => {
    const first = applyLogToSegments(
      createEmptyAssembledTurn(),
      makeLog("dup-1", "stdout", "正文"),
    );
    expect(first.output).toBe("正文");
    const replayed = applyLogToSegments(first, makeLog("dup-1", "stdout", "重放事件不同内容"));
    expect(replayed).toBe(first);
  });

  it("SSE 路径不做内容级去重：同文不同 log_id 照常装配（两路语义不合并，Grill X-08）", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "答复"),
      makeLog("2", "stdout", "答复"),
    ]);
    expect(turn.segments).toEqual([
      { kind: "text", id: "text:1", text: "答复答复", streaming: false, startedAt: null },
    ]);
  });

  it("历史路径（默认开启）：重复 kind+文本只保留一条", () => {
    const segments = logsToSegments([
      makeLog("1", "stdout", "答复"),
      makeLog("2", "stdout", "答复"),
    ]);
    expect(segments).toEqual([
      { kind: "text", id: "text:1", text: "答复", streaming: false, startedAt: null },
    ]);
  });

  it("历史路径键规则：键含 kind（异 kind 同文本不去重）；user_input 占键；分类丢弃行不产段", () => {
    // 键含 kind：thinking 与 reply 同文本不同键，都保留
    const mixed = logsToSegments([
      makeLog("1", null, "[THINKING] 同文"),
      makeLog("2", "stdout", "同文"),
    ]);
    expect(mixed.map((s) => s.kind)).toEqual(["thinking", "text"]);
    // user_input 占键（分类键与 reply 同池）：后到的同文 agent 行被滤，防 user/agent 同文重复显示
    const occupied = [
      makeLog("1", "user_input", "你好"),
      makeLog("2", "stdout", "你好"),
    ];
    expect(logsToSegments(occupied)).toEqual([]);
    // 关闭去重时该行正常装配——证明上面是被键命中滤掉，而非 channel 跳过
    expect(logsToSegments(occupied, { seenTextDedup: false })).toEqual([
      { kind: "text", id: "text:2", text: "你好", streaming: false, startedAt: null },
    ]);
    // 分类丢弃行（SYSTEM 协议行）不产段、重复无副作用，不影响后续行装配
    expect(
      logsToSegments([
        makeLog("1", null, "[SYSTEM:thinking_tokens] 48"),
        makeLog("2", null, "[SYSTEM:thinking_tokens] 48"),
        makeLog("3", "stdout", "正文"),
      ]),
    ).toEqual([{ kind: "text", id: "text:3", text: "正文", streaming: false, startedAt: null }]);
  });

  it("options.seenTextDedup:false 关闭内容级去重（保留逐条原文场景）", () => {
    const segments = logsToSegments(
      [makeLog("1", "stdout", "答复"), makeLog("2", "stdout", "答复")],
      { seenTextDedup: false },
    );
    expect(segments).toEqual([
      { kind: "text", id: "text:1", text: "答复答复", streaming: false, startedAt: null },
    ]);
  });
});

/* ───────── 7. 历史与实时一致性（§9.1 / §9.4 投影） ───────── */

describe("历史与实时一致性（§9.1 同一装配语义 / §9.4 投影映射）", () => {
  it("同一日志序列：逐条 applyLogToSegments 的最终 segments 与 logsToSegments 批量产出深度相等", () => {
    const ts = "2026-08-19T10:00:00.000Z";
    const logs: AssemblerLogInput[] = [
      makeLog("1", "user_input", "帮我调研", { timestamp: ts }),
      makeLog("2", null, "[THINKING] 先分析", { timestamp: ts }),
      makeLog(
        "3",
        "tool_call",
        '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_p","success":true}',
        { timestamp: ts },
      ),
      makeLog("4", null, "[THINKING] 子思考", { parentToolUseId: "tu_p", subagentType: "researcher", timestamp: ts }),
      makeLog(
        "5",
        "tool_call",
        '{"tool":"Bash","args":{"command":"ls"},"tool_use_id":"tu_s","success":true}',
        { parentToolUseId: "tu_p", timestamp: ts },
      ),
      makeLog("6", "stdout", "[TOOL_RESULT] 子工具输出", { parentToolUseId: "tu_p", timestamp: ts }),
      makeLog("7", "stdout", "子结论", { parentToolUseId: "tu_p", segmentId: "tu_p:3", timestamp: ts }),
      makeLog("8", "stderr", "子代理告警", { parentToolUseId: "tu_p", timestamp: ts }),
      makeLog("9", "stdout", "[TOOL_RESULT] 任务完成", { timestamp: ts }),
      makeLog("10", "stdout", "主答复前半", { segmentId: "main:m1:1", timestamp: ts }),
      makeLog("11", "stdout", "主答复后半", { segmentId: "main:m1:1", timestamp: ts }),
    ];
    let turn = createEmptyAssembledTurn();
    for (const log of logs) {
      turn = applyLogToSegments(turn, log);
    }
    // 非平凡树（顶层多段 + 嵌套子代理桶），防空等价断言空转
    expect(turn.segments.length).toBeGreaterThanOrEqual(3);
    expect(toolById(turn.segments, "tu_p").children.length).toBeGreaterThanOrEqual(3);
    // 历史与实时两路径产出深度相等（序列无 kind+文本重复、logId 唯一，排除两路去重干扰）
    expect(logsToSegments(logs)).toEqual(turn.segments);
  });

  it("segmentsToLegacy 投影：output=文本段按 DFS 序拼接；processItems 的 ts 映射（tool.startedAt→ts）", () => {
    const t1 = "2026-08-19T10:00:01.000Z";
    const t2 = "2026-08-19T10:00:02.000Z";
    const t3 = "2026-08-19T10:00:03.000Z";
    const t4 = "2026-08-19T10:00:04.000Z";
    const t5 = "2026-08-19T10:00:05.000Z";
    const raw = '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_pr","success":true}';
    const turn = applyAll([
      makeLog("1", null, "[THINKING] 思考", { timestamp: t1 }),
      makeLog("2", "tool_call", raw, { timestamp: t2 }),
      makeLog("3", "stdout", "子结论", { parentToolUseId: "tu_pr", timestamp: t3 }),
      makeLog("4", "stderr", "告警", { timestamp: t4 }),
      makeLog("5", "stdout", "主文本", { timestamp: t5 }),
    ]);
    const legacy = segmentsToLegacy(turn.segments);
    // output：文本段按 DFS 序拼接（tool 的 children 文本先于其后顶层文本；无分隔符）
    expect(legacy.output).toBe("子结论主文本");
    expect(legacy.processItems).toEqual([
      { kind: "thinking", text: "思考", ts: Date.parse(t1) },
      { kind: "tool", raw, status: "ok", ts: Date.parse(t2) },
      { kind: "stderr", text: "告警", ts: Date.parse(t4) },
    ]);
    // applyLogToSegments 维护的投影与显式重算一致（同源投影，过渡期双字段零漂移）
    expect(turn.output).toBe(legacy.output);
    expect(turn.processItems).toEqual(legacy.processItems);
  });

  it("turnStartedAt 锚点：live/attach 均缺时取首条有效 log timestamp；调用方置入后不被覆盖（§7.5）", () => {
    const t1 = "2026-08-19T10:00:01.000Z";
    const turn = applyAll([makeLog("1", "stdout", "正文", { timestamp: t1 })]);
    expect(turn.turnStartedAt).toBe(Date.parse(t1));
    const live = applyLogToSegments(
      createEmptyAssembledTurn(12345),
      makeLog("2", "stdout", "x", { timestamp: t1 }),
    );
    expect(live.turnStartedAt).toBe(12345);
  });
});

/* ───────── 8. streaming（§5 Phase3） ───────── */

describe("streaming 置位与清除（§5 Phase3）", () => {
  it("带 segmentId 的 partial 追加置 streaming（新建与续接）；无 segmentId 追加不改变原值", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "整段消息"),
      makeLog("2", "stdout", "partial-1", { segmentId: "main:s1:1" }),
      makeLog("3", "stdout", "partial-2", { segmentId: "main:s1:1" }),
      makeLog("4", "stdout", "整段续接"),
    ]);
    // log2 的 partial 不与异源整段（text:1）续接 → 开新段置位；log3 续接同派生段保持置位；
    // ql-20260820-011：log4 无 segmentId（完整行）不再 merge 进 partial 派生段
    // （override 连坐撤回根因）→ 独立普通段，streaming false。
    expect(turn.segments).toEqual([
      { kind: "text", id: "text:1", text: "整段消息", streaming: false, startedAt: null },
      {
        kind: "text",
        id: "text:main:s1:1",
        text: "partial-1partial-2",
        streaming: true,
        startedAt: null,
        segId: "main:s1:1",
      },
      { kind: "text", id: "text:4", text: "整段续接", streaming: false, startedAt: null },
    ]);
  });

  it("override 撤回随段清除：被撤 partial 的段移除，其它 partial 的 streaming 不受影响", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "p1", { segmentId: "main:a:1" }),
      makeLog("2", "stdout", "p2", { segmentId: "main:b:1" }),
    ]);
    expect(turn.segments.map((s) => s.id)).toEqual(["text:main:a:1", "text:main:b:1"]);
    expect(turn.segments.every((s) => expectText(s).streaming)).toBe(true);
    const after = applyLogToSegments(turn, makeLog("3", null, "[ASSISTANT_OVERRIDE] main:a:1"));
    expect(after.segments.map((s) => s.id)).toEqual(["text:main:b:1"]);
    expect(expectText(after.segments[0]).streaming).toBe(true);
    // 未触及段引用稳定（path-copy，FR-06）
    expect(after.segments[0]).toBe(turn.segments[1]);
  });

  it("finishTurn 清除全树 streaming（含 tool 段 children 内嵌套段），投影与集合不变", () => {
    const raw = '{"tool":"Task","args":{"description":"子"},"tool_use_id":"tu_f","success":true}';
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeLog("2", "stdout", "子partial", { parentToolUseId: "tu_f", segmentId: "tu_f:1" }),
      makeLog("3", "stdout", "主partial", { segmentId: "main:f:1" }),
    ]);
    // 撤回前：顶层与嵌套 partial 均置位
    expect(expectText(toolById(turn.segments, "tu_f").children[0]).streaming).toBe(true);
    expect(expectText(turn.segments[1]).streaming).toBe(true);
    const done = finishTurn(turn);
    expect(done.segments).toEqual([
      {
        kind: "tool",
        id: "tu_f",
        raw,
        status: "ok",
        toolName: "Task",
        primary: "子",
        startedAt: null,
        endedAt: null,
        children: [
          { kind: "text", id: "text:tu_f:1", text: "子partial", streaming: false, startedAt: null, segId: "tu_f:1" },
        ],
        subagentType: null,
      },
      { kind: "text", id: "text:main:f:1", text: "主partial", streaming: false, startedAt: null, segId: "main:f:1" },
    ]);
    // streaming 不入投影：output / processItems / seenLogIds 原样（集合同引用）
    expect(done.output).toBe(turn.output);
    expect(done.processItems).toEqual(turn.processItems);
    expect(done.seenLogIds).toBe(turn.seenLogIds);
  });

  it("finishTurn 无 streaming 段 → 原引用返回（FR-06 引用稳定）", () => {
    const turn = applyAll([makeLog("1", "stdout", "整段")]);
    expect(finishTurn(turn)).toBe(turn);
  });
});

// ── ql-20260820-008：主参数摘要提取（extractPrimaryArg 通用兜底链） ────────

describe("主参数摘要提取（ql-20260820-008：通用链 pattern/query/url）", () => {
  function toolPrimary(raw: string): string | null {
    const turn = applyAll([makeLog("1", "tool_call", raw)]);
    const seg = turn.segments[0];
    return seg?.kind === "tool" ? seg.primary : null;
  }

  it("Grep/Glob 走 pattern：显示搜索表达式而非半截 JSON", () => {
    expect(
      toolPrimary(
        '{"tool":"Grep","args":{"head_limit":10,"output_mode":"files_with_matches","path":"F:/WorkNew/SillyHub","pattern":"currentRunId"},"tool_use_id":"tu_g"}',
      ),
    ).toBe("currentRunId");
    expect(
      toolPrimary('{"tool":"Glob","args":{"pattern":"frontend/src/app/**/*.tsx"},"tool_use_id":"tu_gl"}'),
    ).toBe("frontend/src/app/**/*.tsx");
  });

  it("WebSearch/WebFetch 走 query/url", () => {
    expect(
      toolPrimary('{"tool":"WebSearch","args":{"query":"sse reconnect best practice"},"tool_use_id":"tu_ws"}'),
    ).toBe("sse reconnect best practice");
    expect(
      toolPrimary('{"tool":"WebFetch","args":{"url":"https://example.com/api"},"tool_use_id":"tu_wf"}'),
    ).toBe("https://example.com/api");
  });

  it("description 仍优先于 pattern（带描述的工具不受影响）", () => {
    expect(
      toolPrimary(
        '{"tool":"PowerShell","args":{"description":"检查重构提交","command":"git show b0f2a115"},"tool_use_id":"tu_ps"}',
      ),
    ).toBe("检查重构提交");
  });

  it("全部键缺失仍回退 raw 前 120 字符（既有兜底零回归）", () => {
    const raw = '{"tool":"Unknown","args":{"foo":"bar"},"tool_use_id":"tu_u"}';
    expect(toolPrimary(raw)).toBe(raw.slice(0, 120));
  });
});

// ── ql-20260820-011：完整行不 merge 进 partial 派生段（override 连坐撤回根因） ──

describe("完整行与 partial 派生段隔离（ql-20260820-011）", () => {
  it("复刻用户场景：partial 流式 → 完整行 → override 撤回 → 完整文本保留", () => {
    const turn = applyAll([
      makeLog("p1", "stdout", "半截流式内", { segmentId: "main:msg_7:1" }),
    ]);
    // 完整行（daemon 在 partial 后转发，log_id 独立、无 segmentId）
    const withFull = applyLogToSegments(
      turn,
      makeLog("full-1", "stdout", "[ASSISTANT] 半截流式内容完整版，全文在此。"),
    );
    // 用户反馈⑥修订契约：完整行文本是 partial 前缀 → 立即收编（移除 partial、
    // 全文承载），不再等 override——实锾示范 override 可能丢失，旧"两段并存
    // 等 override"会让重复显示留到轮末（会话 a54fa0e4 实证）。分叉（非前缀）
    // 时保守并存由「重复显示防御」用例覆盖。
    const textSegs = withFull.segments.filter((s) => s.kind === "text");
    expect(textSegs).toHaveLength(1);
    expect(withFull.output).toBe("半截流式内容完整版，全文在此。");

    // override 在完整行之后到达（session-manager fire-and-forget 时序）→ 幂等
    // 空操作（partial 已收编，无撤回目标），终态不变。
    const after = applyLogToSegments(
      withFull,
      makeLog("ov-1", null, "[ASSISTANT_OVERRIDE] main:msg_7:1"),
    );
    expect(after.segments.filter((s) => s.kind === "text")).toHaveLength(1);
    expect(after.output).toBe("半截流式内容完整版，全文在此。");
  });

  it("普通连续完整行 merge 行为不变（无 partial 时单段拼接）", () => {
    const turn = applyAll([
      makeLog("a-1", "stdout", "[ASSISTANT] 第一段。"),
      makeLog("a-2", "stdout", "[ASSISTANT] 第二段。"),
    ]);
    const textSegs = turn.segments.filter((s) => s.kind === "text");
    expect(textSegs).toHaveLength(1);
    expect(turn.output).toBe("第一段。第二段。");
  });

  it("同源 partial 续接仍 merge（partial 间按 segmentId 对齐不受影响）", () => {
    const turn = applyAll([
      makeLog("p1", "stdout", "前半", { segmentId: "main:msg_8:1" }),
      makeLog("p2", "stdout", "后半", { segmentId: "main:msg_8:1" }),
    ]);
    const textSegs = turn.segments.filter((s) => s.kind === "text");
    expect(textSegs).toHaveLength(1);
    expect(textSegs[0]).toMatchObject({ streaming: true, text: "前半后半" });
  });
});

/* ───────── 9. FileUpload 文件段（task-08 / 2026-08-23-agent-file-upload-mcp / FR-01 / design §7.3） ───────── */

describe("FileUpload 文件段（task-08 / FR-01 / design §7.3）", () => {
  const T1 = "2026-08-23T09:30:00.000Z";
  /** task-03 契约：channel=tool_call、tool_kind=FileUpload、content 五字段 JSON。 */
  const FILE_JSON = JSON.stringify({
    file_id: "f-1",
    original_name: "q3-bug-trend.png",
    size: 186368,
    mime_type: "image/png",
    description: "三季度 Bug 趋势图",
  });

  function makeFileLog(
    id: string,
    content: string,
    extra?: Partial<AssemblerLogInput>,
  ): AssemblerLogInput {
    return makeLog(id, "tool_call", content, {
      toolKind: "FileUpload",
      timestamp: T1,
      ...extra,
    });
  }

  it("tool_kind=FileUpload 的 tool_call 行 → file 段（五字段取自 content JSON、ts 取 log timestamp），同轮不产生 tool_use 段（R-07 锚点）", () => {
    const turn = applyAll([makeFileLog("1", FILE_JSON)]);
    expect(turn.segments).toEqual([
      {
        kind: "file",
        id: "file:1",
        fileId: "f-1",
        name: "q3-bug-trend.png",
        size: 186368,
        mime: "image/png",
        description: "三季度 Bug 趋势图",
        ts: Date.parse(T1),
      },
    ]);
    expect(turn.segments.some((s) => s.kind === "tool")).toBe(false);
  });

  it("content 非 JSON / 缺 file_id → 回退通用 tool_use 映射不丢行（raw 原样进 tool 段）", () => {
    const badText = "upload_file 上传失败：文件不存在";
    const missingId = JSON.stringify({ size: 1, mime_type: "text/plain", description: "" });
    const turn = applyAll([
      makeFileLog("1", badText),
      makeFileLog("2", missingId),
    ]);
    expect(turn.segments.map((s) => s.kind)).toEqual(["tool", "tool"]);
    expect(expectTool(turn.segments[0]).raw).toBe(badText);
    expect(expectTool(turn.segments[1]).raw).toBe(missingId);
  });

  it("未知 / 缺省 tool_kind 的 tool_call 行 → 仍走通用 tool_use 映射（既有策略零回归，design §9）", () => {
    const turn = applyAll([
      makeLog("1", "tool_call", FILE_JSON),
      makeLog("2", "tool_call", FILE_JSON, { toolKind: "SomethingElse" }),
    ]);
    expect(turn.segments).toHaveLength(2);
    expect(turn.segments.every((s) => s.kind === "tool")).toBe(true);
  });

  it("segmentsToLegacy 投影 file 段为 kind:'file' 过程项（历史回放可见；output 零贡献）", () => {
    // ql 修复（agent-file-upload-mcp 部署验证发现）：原实现跳过 file 段导致会话
    // 面板历史回放（经 segmentsToLegacy 渲染）刷新后文件卡片消失，违反 FR-01
    // 「刷新后仍在原位」——改为投影 file 过程项由 TurnDetailsList 渲染卡片。
    const turn = applyAll([
      makeLog("1", "stdout", "图表已生成"),
      makeFileLog("2", FILE_JSON),
    ]);
    expect(turn.segments.map((s) => s.kind)).toEqual(["text", "file"]);
    expect(turn.output).toBe("图表已生成");
    expect(turn.processItems).toEqual([
      {
        kind: "file",
        fileId: "f-1",
        name: "q3-bug-trend.png",
        size: 186368,
        mime: "image/png",
        description: "三季度 Bug 趋势图",
        ts: Date.parse(T1),
      },
    ]);
  });

  it("logsToSegments 两路去重不受影响：不同文件不去重（键含 fileId）、同 file_id 重复行内容级去重、SSE log_id 去重照常", () => {
    const json2 = JSON.stringify({
      file_id: "f-2",
      original_name: "q3-bug-data.csv",
      size: 47104,
      mime_type: "text/csv",
      description: "",
    });
    // 两个不同文件：file 段 text 恒空，若仍按 kind:text 做键会误去重——键必须含 fileId
    const two = logsToSegments([makeFileLog("1", FILE_JSON), makeFileLog("2", json2)]);
    expect(two.map((s) => (s.kind === "file" ? s.fileId : s.kind))).toEqual(["f-1", "f-2"]);
    // 同 file_id 重复行（重放）：内容级去重兜底（后端另有 (run_id, dedup_key) 唯一索引）
    const dup = logsToSegments([makeFileLog("1", FILE_JSON), makeFileLog("2", FILE_JSON)]);
    expect(dup).toHaveLength(1);
    // SSE 实时路径 log_id 去重：重复 input 原引用返回（file 行同样适用）
    const turn = applyAll([makeFileLog("1", FILE_JSON)]);
    expect(applyLogToSegments(turn, makeFileLog("1", FILE_JSON))).toBe(turn);
  });

  it("parent_tool_use_id 归属路由：子代理上传的文件段进父工具段 children（file 段可嵌套）", () => {
    const raw = '{"tool":"Task","args":{"description":"子"},"tool_use_id":"tu_s","success":true}';
    const turn = applyAll([
      makeLog("1", "tool_call", raw),
      makeFileLog("2", FILE_JSON, { parentToolUseId: "tu_s" }),
    ]);
    const tool = toolById(turn.segments, "tu_s");
    expect(tool.children.map((s) => s.kind)).toEqual(["file"]);
    expect(tool.children[0]).toMatchObject({ fileId: "f-1", ts: Date.parse(T1) });
  });
});

/* ───────── 10. 技能装载注入行（ql-20260824-017） ───────── */

// Claude Code 装载技能的日志序列（DB run d01bd6d2 实证）：
//   [TOOL_USE] Skill: {json}（stdout，与 tool_call JSON 双发）
//   {"tool":"Skill",...}（tool_call JSON，权威源）
//   [TOOL_RESULT] Launching skill: sillyspec-execute
//   [ASSISTANT] Base directory for this skill: ...\n<SKILL.md 全文>   ← 本组被测行
// SKILL.md 全文以 assistant 文本块注入，修复前归 reply 进对话正文（用户投诉），
// 修复后归过程信息：挂到同桶内最近 Skill 工具段的 result，对话视图不含。
describe("技能装载注入行（ql-20260824-017：不进对话正文，挂 Skill 工具段 result）", () => {
  const T_SKILL_USE = "2026-08-24T05:04:20.344Z";
  const T_SKILL_BODY = "2026-08-24T05:04:20.410Z";
  const SKILL_BODY =
    "Base directory for this skill: C:\\repo\\.claude\\skills\\sillyspec-execute\n\n## 何时使用\n\n- 用户说\"开始写代码、执行任务、跑 execute、开干\"";

  function makeSkillTurn(): AssembledTurn {
    return applyAll([
      makeLog("1", "stdout", `[TOOL_USE] Skill: {"skill":"sillyspec-execute"}`, {
        timestamp: T_SKILL_USE,
      }),
      makeLog(
        "2",
        "tool_call",
        '{"tool":"Skill","args":{"skill":"sillyspec-execute","args":"--change c1"},"tool_use_id":"tu_sk1","success":true}',
        { timestamp: T_SKILL_USE },
      ),
      makeLog("3", "stdout", "[TOOL_RESULT] Launching skill: sillyspec-execute", {
        timestamp: T_SKILL_USE,
      }),
      makeLog("4", "stdout", `[ASSISTANT] ${SKILL_BODY}`, { timestamp: T_SKILL_BODY }),
    ]);
  }

  it("classifySessionLog：[ASSISTANT] Base directory 前缀行归 kind=skill（非 reply）；裸文本（用户手打）不受影响", () => {
    expect(classifySessionLog(`[ASSISTANT] ${SKILL_BODY}`, "stdout")).toEqual({
      kind: "skill",
      text: SKILL_BODY,
    });
    // 无 [ASSISTANT] 前缀的裸文本（user_input / codex 无前缀流）不误吞
    expect(classifySessionLog(SKILL_BODY, "user_input")?.kind).toBe("reply");
    expect(classifySessionLog("[ASSISTANT] 正常答复", "stdout")?.kind).toBe("reply");
  });

  it("注入行不进对话正文（output 零贡献），全文追加到最近 Skill 工具段 result", () => {
    const turn = makeSkillTurn();
    expect(turn.output).toBe("");
    expect(turn.segments.map((s) => s.kind)).toEqual(["tool"]);
    const skillTool = toolById(turn.segments, "tu_sk1");
    expect(skillTool.toolName).toBe("Skill");
    expect(skillTool.result).toBe(`Launching skill: sillyspec-execute\n\n${SKILL_BODY}`);
    expect(skillTool.status).toBe("ok");
    expect(skillTool.endedAt).toBe(Date.parse(T_SKILL_BODY));
  });

  it("同轮多次技能装载：各自挂到最近的 Skill 工具段（不串段）", () => {
    const turn = applyAll([
      makeLog(
        "1",
        "tool_call",
        '{"tool":"Skill","args":{"skill":"a"},"tool_use_id":"tu_sk_a","success":true}',
      ),
      makeLog("2", "stdout", "[ASSISTANT] Base directory for this skill: pa\n\nA", {}),
      makeLog(
        "3",
        "tool_call",
        '{"tool":"Skill","args":{"skill":"b"},"tool_use_id":"tu_sk_b","success":true}',
      ),
      makeLog("4", "stdout", "[ASSISTANT] Base directory for this skill: pb\n\nB", {}),
    ]);
    expect(toolById(turn.segments, "tu_sk_a").result).toBe("Base directory for this skill: pa\n\nA");
    expect(toolById(turn.segments, "tu_sk_b").result).toBe("Base directory for this skill: pb\n\nB");
    expect(turn.output).toBe("");
  });

  it("归属桶路由：子代理装载的技能注入行挂进该子代理 children 内的 Skill 工具段", () => {
    const turn = applyAll([
      makeLog(
        "1",
        "tool_call",
        '{"tool":"Task","args":{"description":"子"},"tool_use_id":"tu_sub","success":true}',
      ),
      makeLog(
        "2",
        "tool_call",
        '{"tool":"Skill","args":{"skill":"a"},"tool_use_id":"tu_sk_sub","success":true}',
        { parentToolUseId: "tu_sub" },
      ),
      makeLog("3", "stdout", "[ASSISTANT] Base directory for this skill: p\n\nX", {
        parentToolUseId: "tu_sub",
      }),
    ]);
    const sub = toolById(turn.segments, "tu_sub");
    const inner = toolById(sub.children, "tu_sk_sub");
    expect(inner.result).toBe("Base directory for this skill: p\n\nX");
    expect(turn.output).toBe("");
  });

  it("兜底：桶内无 Skill 工具段（tool_call JSON 丢失 / 注入先到的旧数据）→ 退化为文本段，不丢内容", () => {
    const turn = applyAll([
      makeLog("1", "stdout", "前文"),
      makeLog("2", "stdout", `[ASSISTANT] ${SKILL_BODY}`),
    ]);
    // 前文与注入行同为无 segmentId 文本 → 续接同段直拼（与修复前 reply 行为一致）
    expect(turn.segments).toHaveLength(1);
    expect(turn.segments.map((s) => s.kind)).toEqual(["text"]);
    expect(turn.output).toBe(`前文${SKILL_BODY}`);
  });

  it("历史批量路径（logsToSegments）与实时路径同一装配语义", () => {
    const segments = logsToSegments([
      makeLog(
        "1",
        "tool_call",
        '{"tool":"Skill","args":{"skill":"a"},"tool_use_id":"tu_sk_h","success":true}',
      ),
      makeLog("2", "stdout", "[ASSISTANT] Base directory for this skill: p\n\nH"),
    ]);
    const tool = toolById(segments, "tu_sk_h");
    expect(tool.result).toBe("Base directory for this skill: p\n\nH");
    const legacy = segmentsToLegacy(segments);
    expect(legacy.output).toBe("");
    expect(legacy.processItems).toEqual([
      {
        kind: "tool",
        raw: expect.stringContaining('"Skill"'),
        result: "Base directory for this skill: p\n\nH",
        status: "ok",
        ts: undefined,
      },
    ]);
  });
});

// ── 2026-08-25-unified-floating-session task-11：前导段提取（FR-7）──────────
describe("extractPreambleText", () => {
  it("含【页面上下文】+ 分隔线 → 提取前导块", () => {
    const out = extractPreambleText(
      "【页面上下文】\n- 页面：工作区详情\n- 工作区：map\n\n---\n\n你好",
    );
    expect(out).toBe("【页面上下文】\n- 页面：工作区详情\n- 工作区：map");
  });

  it("普通用户消息 → null（不误伤）", () => {
    expect(extractPreambleText("你好")).toBeNull();
  });

  it("同标题开头但无分隔 → null（用户自己输入的原文不算前导）", () => {
    expect(extractPreambleText("【页面上下文】\n- 页面：测试")).toBeNull();
  });

  it("【团队任务简报】开头同样识别", () => {
    expect(
      extractPreambleText("【团队任务简报】\n- 目标：x\n\n---\n\n开工"),
    ).toBe("【团队任务简报】\n- 目标：x");
  });
});

// ── 用户反馈⑥：会话重复显示（partial+全文双气泡防御）────────────────────
describe("重复显示防御（用户反馈⑥）", () => {
  it("完整回复行到达时移除同文本前缀的直播 partial 段（override 丢失场景）", () => {
    const turn = applyAll([
      makeLog("l1", "stdout", "[ASSISTANT] 这是 multi-agent", { segmentId: "main:seg-1" }),
      makeLog("l2", "stdout", "[ASSISTANT] 这是 multi-agent-platform 工作区的详情页面。"),
    ]);
    const texts = turn.segments.filter((s) => s.kind === "text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as TextTurnSegment).text).toContain("详情页面");
  });

  it("partial 与全文内容分叉（非前缀）时保守保留双方", () => {
    const turn = applyAll([
      makeLog("l3", "stdout", "[ASSISTANT] 完全不同的开头", { segmentId: "main:seg-2" }),
      makeLog("l4", "stdout", "[ASSISTANT] 这是另一个完整回答"),
    ]);
    expect(turn.segments.filter((s) => s.kind === "text").length).toBe(2);
  });
});

// ── 用户反馈⑥续（e3b86010）：终态收敛去重，任意到达顺序 ────────────────────
describe("finishTurn 终态前缀去重（用户反馈⑥续）", () => {
  it("乱序：完整行先到、流式残段后到 → 终态收敛为单段", () => {
    const turn = applyAll([
      makeLog("f1", "stdout", "[ASSISTANT] 完整回答全文在此。"),
      makeLog("p1", "stdout", "完整回答", { segmentId: "main:late:1" }),
    ]);
    const finished = finishTurn(turn);
    const texts = finished.segments.filter((s) => s.kind === "text");
    expect(texts).toHaveLength(1);
    expect(finished.output).toBe("完整回答全文在此。");
  });

  it("连续完整行按设计合并为单段（多行回复累积，非前缀去重误伤）", () => {
    const turn = applyAll([
      makeLog("m1", "stdout", "[ASSISTANT] 第一段独立回答。"),
      makeLog("m2", "stdout", "[ASSISTANT] 第二段独立回答。"),
    ]);
    const finished = finishTurn(turn);
    const texts = finished.segments.filter((s) => s.kind === "text");
    expect(texts).toHaveLength(1);
    expect(finished.output).toContain("第一段独立回答。");
    expect(finished.output).toContain("第二段独立回答。");
  });

  it("空文本段不参与去重判定（不误删合法结构）", () => {
    const turn = applyAll([
      makeLog("e1", "stdout", "[ASSISTANT] 唯一回答。"),
      makeLog("e2", "stdout", "[ASSISTANT]", { segmentId: "main:x:1" }),
    ]);
    const finished = finishTurn(turn);
    expect(finished.output).toBe("唯一回答。");
  });
});

// ── quick-9f86d2c3（会话 e87622aa）：终态轮迟到 partial——重复段+光标常闪 ──────
// 事件序实证（run 6f5720ab）：partial（segment_id=main:<mid>:text）实时发布丢失，
// turn_completed 处理完后经轮后对账 / 断线 resync 重放到达 → 装配器对「full 已在场、
// partial 迟到」原先无反向收编，partial 以 streaming=true 新段落地且 finishTurn 已
// 跑过永不再清（重复段 + 光标常闪）。修复：反向前缀收编 + segId 封存。
describe("迟到 partial 反向收编与 segId 封存（quick-9f86d2c3）", () => {
  it("full 先在场、终态后迟到 partial（前缀命中）→ 不落段不置 streaming（光标不常亮）", () => {
    const turn = applyAll([
      makeLog("t1", "stdout", "[THINKING] Docker is running…"),
      makeLog("tf", "stdout", "[ASSISTANT] 只有 pdftotext 可用，我用 Node + pdfjs-dist(自带 CMap)再试一次。"),
      makeLog("tt", "stdout", "[TOOL_USE] Bash: node --version"),
    ]);
    const finished = finishTurn(turn);
    // 终态后对账重放的 partial（是 full 的严格前缀）
    const after = applyLogToSegments(
      finished,
      makeLog("tp", "stdout", "[ASSISTANT] 只有 pdftotext 可用，我用 Node + pdfjs-dist(", {
        segmentId: "main:msg-late:text",
      }),
    );
    const texts = after.segments.filter((s) => s.kind === "text") as TextTurnSegment[];
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toContain("再试一次。");
    expect(texts.every((t) => !t.streaming)).toBe(true);
    expect(after.output).toBe(finished.output);
  });

  it("封存后同 segmentId 的后续窗口（非前缀增量）不再复活重复段", () => {
    const turn = applyAll([
      makeLog("wf", "stdout", "[ASSISTANT] 窗口一窗口二的完整全文。"),
      // 窗口 1：full 前缀 → 反向收编 + 封存 main:msg-w:text
      makeLog("wp1", "stdout", "[ASSISTANT] 窗口一", { segmentId: "main:msg-w:text" }),
      // 窗口 2：增量与 full 非前缀关系——封存后整体跳过（partial ⊆ full 恒成立）
      makeLog("wp2", "stdout", "[ASSISTANT] 窗口二的完整全文", { segmentId: "main:msg-w:text" }),
    ]);
    const texts = turn.segments.filter((s) => s.kind === "text") as TextTurnSegment[];
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toContain("完整全文。");
    expect(turn.output).toBe("窗口一窗口二的完整全文。");
  });

  it("正向吸收（full 后到收编尾部 partial）同样封存，重放窗口不复活", () => {
    const turn = applyAll([
      makeLog("fp", "stdout", "[ASSISTANT] 前缀部分", { segmentId: "main:msg-f:text" }),
      makeLog("ff", "stdout", "[ASSISTANT] 前缀部分的完整全文在此。"),
    ]);
    expect(turn.segments.filter((s) => s.kind === "text")).toHaveLength(1);
    // 同 segId 迟到重放（对账窗口增量）——封存生效，不新建段
    const after = applyLogToSegments(
      turn,
      makeLog("fp2", "stdout", "[ASSISTANT] 前缀部分", { segmentId: "main:msg-f:text" }),
    );
    expect(after.segments.filter((s) => s.kind === "text")).toHaveLength(1);
    expect(after.output).toBe("前缀部分的完整全文在此。");
  });

  it("partial 与在场 full 内容分叉（非前缀）→ 照常落段（保守并存不误伤）", () => {
    const turn = applyAll([
      makeLog("df", "stdout", "[ASSISTANT] 完整回答已经在此。"),
      makeLog("dp", "stdout", "[ASSISTANT] 完全不同的新内容", { segmentId: "main:msg-d:text" }),
    ]);
    const texts = turn.segments.filter((s) => s.kind === "text") as TextTurnSegment[];
    expect(texts).toHaveLength(2);
    expect(texts[1]!.segId).toBe("main:msg-d:text");
  });

  it("override 撤回后同 segmentId 重放窗口不再落地", () => {
    const turn = applyAll([
      makeLog("op", "stdout", "[ASSISTANT] 将被撤回的半截", { segmentId: "main:msg-o:text" }),
      makeLog("oo", "stdout", "[ASSISTANT_OVERRIDE] main:msg-o:text"),
      // 撤回后同 segId 重放窗口——封存生效
      makeLog("op2", "stdout", "[ASSISTANT] 将被撤回的半截", { segmentId: "main:msg-o:text" }),
    ]);
    expect(turn.segments.filter((s) => s.kind === "text")).toHaveLength(0);
    expect(turn.output).toBe("");
  });
});
