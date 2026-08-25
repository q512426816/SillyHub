/**
 * ql-20260729-005：logsToTurns 对话/过程信息分流单测。
 * user_input → prompt；reply → output（答复正文）；thinking/tool/stderr → details
 * （默认对话视图不展示，切「全部」后渲染）。
 *
 * 2026-08-19-session-stream-ux / task-11：logsToTurns 内部改走共享装配器
 * logsToSegments + segmentsToLegacy 兼容投影——本文件既有断言验证投影与改前手写
 * 路径等价（output / processItems 逐项一致）；另增 task-11 段模型形状断言
 * （segments / turnStartedAt / 归属嵌套 / 连续 thinking 数据层合并 / 去重保持）。
 */

import { describe, it, expect, vi } from "vitest";

// runtime-session-helpers.tsx 顶层 import 链含 next/navigation（InteractiveSessionChatSection
// 用 useRouter/useSearchParams），本测试只测纯函数 logsToTurns，mock 防 jsdom 下解析异常。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { logsToTurns, runTerminalTurnStatus } from "../runtime-session-helpers";
import type { TurnSegment } from "../session-log-assembler";
import type { AgentRunLogEntry } from "@/lib/agent";

/**
 * task-11 测试视角：logsToTurns 产出的 turn 实际携带 segments / turnStartedAt 两个
 * 新增字段（运行时为真，类型声明归 task-06 收编进 SessionTurnView），此处交叉类型
 * 断言用。等 task-06 落地后可去掉本垫片直接读字段。
 */
type TurnWithSegments = ReturnType<typeof logsToTurns>[number] & {
  segments?: TurnSegment[];
  turnStartedAt?: number | null;
};

/** 便捷封装：logsToTurns + 段字段视角断言（见 TurnWithSegments 注）。 */
function toSegmentTurns(logs: AgentRunLogEntry[]): TurnWithSegments[] {
  return logsToTurns(logs) as TurnWithSegments[];
}

function makeLog(
  id: string,
  runId: string,
  channel: string | null,
  content: string,
  /** task-11：归属三字段 / tool_kind / timestamp 等可选覆盖（子代理嵌套与计时锚点用例）。 */
  extra?: Partial<AgentRunLogEntry>,
): AgentRunLogEntry {
  return {
    id,
    run_id: runId,
    channel,
    content_redacted: content,
    ...extra,
  } as unknown as AgentRunLogEntry;
}

describe("logsToTurns 对话/过程分流（ql-20260730-003 processItems 有序）", () => {
  it("reply 进 output，thinking/tool/stderr 按到达顺序进 processItems，user_input 进 prompt", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "帮我看看这个文件"),
      makeLog("2", "run-1", null, "[THINKING] 先分析下结构"),
      makeLog("3", "run-1", "tool_call", "Read src/a.ts"),
      makeLog("4", "run-1", "stderr", "permission denied"),
      makeLog("5", "run-1", "stdout", "文件内容是这样的"),
      makeLog("6", "run-1", null, "[ASSISTANT] 总结一下"),
    ]);

    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    // ql-20260802-001：realRunId 保留真实 run_id（turn.runId 是伪 __attach_history_N__ id）
    expect(turn.realRunId).toBe("run-1");
    expect(turn.prompt).toBe("帮我看看这个文件");
    // output 只含答复正文（reply 流式 delta 直接 concat，ql-20260730-004）
    expect(turn.output).toBe("文件内容是这样的总结一下");
    expect(turn.output).not.toContain("先分析下结构");
    expect(turn.output).not.toContain("Read src/a.ts");
    // processItems 按真实到达顺序：thinking → tool(running) → stderr
    expect(turn.processItems).toEqual([
      { kind: "thinking", text: "先分析下结构" },
      { kind: "tool", raw: "Read src/a.ts", status: "running" },
      { kind: "stderr", text: "permission denied" },
    ]);
  });

  it("SYSTEM/RESULT/AskUserQuestion 行仍丢弃，不进 output 也不进 processItems", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", null, "[SYSTEM:thinking_tokens] 48"),
      makeLog("2", "run-1", null, "[RESULT:done] ok"),
      makeLog("3", "run-1", null, '{"tool": "AskUserQuestion"}'),
      makeLog("4", "run-1", "stdout", "正文"),
    ]);
    const turn = turns[0]!;
    expect(turn.output).toBe("正文");
    expect(turn.processItems).toEqual([]);
  });

  it("无过程项的 turn processItems 为空数组", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "你好"),
      makeLog("2", "run-1", "stdout", "你好呀"),
    ]);
    expect(turns[0]!.processItems).toEqual([]);
  });

  it("tool_call JSON(success:true) + [TOOL_RESULT] → ok + 补 result 文本", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "tool_call", '{"tool":"Read","args":{"file_path":"a.ts"},"success":true}'),
      makeLog("2", "run-1", "stdout", "[TOOL_RESULT] 文件内容…"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      {
        kind: "tool",
        raw: '{"tool":"Read","args":{"file_path":"a.ts"},"success":true}',
        result: "文件内容…",
        status: "ok",
      },
    ]);
  });

  it("success:false → deny（不靠 result 文本）；result 配对最近无 result 的 tool", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "tool_call", '{"tool":"Read","args":{"file_path":"a.ts"},"success":true}'),
      makeLog("2", "run-1", "tool_call", '{"tool":"Bash","args":{"command":"ls"},"success":false}'),
      makeLog("3", "run-1", "stdout", "[TOOL_RESULT] command failed: exit 1"),
    ]);
    // use1 success:true → ok（无 result 仍 ok）；use2 success:false → deny；
    // result 到达配最近「无 result」的 use2，补 result、status 保留 deny（不因文本 fail 改变）。
    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: '{"tool":"Read","args":{"file_path":"a.ts"},"success":true}', status: "ok" },
      {
        kind: "tool",
        raw: '{"tool":"Bash","args":{"command":"ls"},"success":false}',
        result: "command failed: exit 1",
        status: "deny",
      },
    ]);
  });

  it("success:true 时 result 文本含 fail 字样仍 ok（isToolResultDenied 收紧不匹配正文 fail）", () => {
    // ql-20260801-004：result 拒绝现可覆盖 success（daemon success 恒 true 不可信），但
    // isToolResultDenied 收紧关键词（去 error/fail）——grep 命中 "fail" 字样属成功输出正文，
    // 不匹配明确拒绝信号 → 保持 ok，不误判 ✗。
    const turns = logsToTurns([
      makeLog("1", "run-1", "tool_call", '{"tool":"Grep","args":{"pattern":"fail"},"success":true}'),
      makeLog("2", "run-1", "stdout", "[TOOL_RESULT] grep 命中 3 处 fail 字样"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      {
        kind: "tool",
        raw: '{"tool":"Grep","args":{"pattern":"fail"},"success":true}',
        result: "grep 命中 3 处 fail 字样",
        status: "ok",
      },
    ]);
  });

  it("Runtime Policy 拒绝：success:true + result 拒绝文本 → deny 覆盖（ql-20260801-004 核心修复）", () => {
    // daemon tool_call JSON 硬编码 success:true（表「已放行」），执行被 Runtime Policy 拦截，
    // 拒绝作为 tool_result 返回（filesystem-policy.ts 文案「Runtime Policy 拒绝本次写入」）。
    // result 含「拒绝」→ isToolResultDenied 命中 → 覆盖 use 的 ok → deny（✗）。
    const turns = logsToTurns([
      makeLog("1", "run-1", "tool_call", '{"tool":"Write","args":{"file_path":"/tmp/x"},"success":true}'),
      makeLog("2", "run-1", "stdout", "[TOOL_RESULT] Runtime Policy 拒绝本次写入。原因：目标目录未配置为可写目录。"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      {
        kind: "tool",
        raw: '{"tool":"Write","args":{"file_path":"/tmp/x"},"success":true}',
        result: "Runtime Policy 拒绝本次写入。原因：目标目录未配置为可写目录。",
        status: "deny",
      },
    ]);
  });

  it("孤儿拒绝 result（无配对 use）→ deny（ql-20260801-004 不硬编码 ok）", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "stdout", "[TOOL_RESULT] 操作失败：权限不足"),
      makeLog("2", "run-1", "stdout", "正文"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: "", result: "操作失败：权限不足", status: "deny" },
    ]);
  });

  it("孤儿 tool_result（无配对 use）降级 raw 空 tool 项，不丢数据", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "stdout", "[TOOL_RESULT] 残留结果"),
      makeLog("2", "run-1", "stdout", "正文"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: "", result: "残留结果", status: "ok" },
    ]);
  });

  it("被工具打断的思考保持顺序不混（task-11 后连续未打断的思考由装配器合并，见下组用例）", () => {
    // 工具穿插其间 → 思考A 与 思考B 分属不同思考段（不合并），保持到达顺序：
    // 思考A → 工具 → 思考B。投影后各自独立入 processItems。
    const turns = logsToTurns([
      makeLog("1", "run-1", null, "[THINKING] 先想想"),
      makeLog("2", "run-1", "tool_call", "Read a.ts"),
      makeLog("3", "run-1", null, "[THINKING] 再想想"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      { kind: "thinking", text: "先想想" },
      { kind: "tool", raw: "Read a.ts", status: "running" },
      { kind: "thinking", text: "再想想" },
    ]);
  });
});

describe("task-11 段模型接入（logsToSegments + 兼容投影）", () => {
  it("turn 带 segments 与 turnStartedAt（组内首条 log timestamp；缺失容错 null）", () => {
    const ts0 = "2026-08-19T10:00:00.000Z";
    const withTs = toSegmentTurns([
      makeLog("1", "run-1", "user_input", "你好", { timestamp: ts0 }),
      makeLog("2", "run-1", "stdout", "你好呀", { timestamp: ts0 }),
    ]);
    expect(withTs[0]!.turnStartedAt).toBe(Date.parse(ts0));
    expect(withTs[0]!.segments).toEqual([
      { kind: "text", id: "text:2", text: "你好呀", streaming: false, startedAt: Date.parse(ts0) },
    ]);
    // 旧数据无 timestamp → null 容错，段照常装配
    const noTs = toSegmentTurns([
      makeLog("1", "run-1", "user_input", "你好"),
      makeLog("2", "run-1", "stdout", "你好呀"),
    ]);
    expect(noTs[0]!.turnStartedAt).toBeNull();
    expect(noTs[0]!.segments).toEqual([
      { kind: "text", id: "text:2", text: "你好呀", streaming: false, startedAt: null },
    ]);
  });

  it("连续 thinking 由装配器在数据层合并为一项（\\n 连接，渲染不再需要重复合并）", () => {
    const turns = toSegmentTurns([
      makeLog("1", "run-1", null, "[THINKING] 先想想"),
      makeLog("2", "run-1", null, "[THINKING] 再想想"),
      makeLog("3", "run-1", null, "[THINKING] 又想想"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      { kind: "thinking", text: "先想想\n再想想\n又想想" },
    ]);
    expect(turns[0]!.segments).toEqual([
      { kind: "thinking", id: "thinking:1", text: "先想想\n再想想\n又想想", streaming: false, ts: null },
    ]);
  });

  it("归属字段（parent_tool_use_id）→ 子代理段嵌套进对应 tool 段 children；投影平铺等价（design §9.1）", () => {
    const turns = toSegmentTurns([
      makeLog(
        "1",
        "run-1",
        "tool_call",
        '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_1","success":true}',
      ),
      makeLog("2", "run-1", null, "[THINKING] 子思考", { parent_tool_use_id: "tu_1", subagent_type: "researcher" }),
      makeLog("3", "run-1", "stdout", "子代理结论", { parent_tool_use_id: "tu_1", subagent_type: "researcher" }),
      makeLog("4", "run-1", "stdout", "[TOOL_RESULT] 子代理完成"),
      makeLog("5", "run-1", "stdout", "主答复"),
    ]);
    const turn = turns[0]!;
    // 段模型：Task tool 段（id=tool_use_id）内嵌子代理 thinking + text；主答复为顶层 text 段
    const segs = turn.segments!;
    expect(segs).toHaveLength(2);
    const toolSeg = segs[0];
    expect(toolSeg?.kind).toBe("tool");
    if (toolSeg?.kind !== "tool") throw new Error("expected tool segment");
    expect(toolSeg.id).toBe("tu_1");
    expect(toolSeg.toolName).toBe("Task");
    expect(toolSeg.status).toBe("ok");
    expect(toolSeg.result).toBe("子代理完成");
    expect(toolSeg.children).toEqual([
      { kind: "thinking", id: "thinking:2", text: "子思考", streaming: false, ts: null },
      { kind: "text", id: "text:3", text: "子代理结论", streaming: false, startedAt: null },
    ]);
    expect(segs[1]).toMatchObject({ kind: "text", text: "主答复" });
    // 兼容投影等价（§9.4）：output 按序含子代理 reply；processItems 平铺（tool → 子 thinking），
    // 与改前无归属感知的平铺产出一致（子代理消息本就按到达顺序穿插在主 tool 之后）。
    expect(turn.output).toBe("子代理结论主答复");
    expect(turn.processItems).toEqual([
      {
        kind: "tool",
        raw: '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_1","success":true}',
        result: "子代理完成",
        status: "ok",
      },
      { kind: "thinking", text: "子思考" },
    ]);
  });

  it("重复内容条目只保留一次（seenText 内容级去重保持，喂入装配器前过滤）", () => {
    const turns = toSegmentTurns([
      makeLog("1", "run-1", "user_input", "帮我查"),
      makeLog("2", "run-1", "user_input", "帮我查"),
      makeLog("3", "run-1", "stdout", "答复"),
      makeLog("4", "run-1", "stdout", "答复"),
    ]);
    const turn = turns[0]!;
    expect(turn.prompt).toBe("帮我查");
    expect(turn.output).toBe("答复");
    expect(turn.segments).toEqual([
      { kind: "text", id: "text:3", text: "答复", streaming: false, startedAt: null },
    ]);
  });

  it("多 run 分组：每组独立装配，段不跨 run", () => {
    const turns = toSegmentTurns([
      makeLog("1", "run-1", "user_input", "第一问"),
      makeLog("2", "run-1", "stdout", "第一答"),
      makeLog("3", "run-2", "user_input", "第二问"),
      makeLog("4", "run-2", "stdout", "第二答"),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.realRunId).toBe("run-1");
    expect(turns[1]!.realRunId).toBe("run-2");
    expect(turns[0]!.segments?.map((s) => (s.kind === "text" ? s.text : s.kind))).toEqual(["第一答"]);
    expect(turns[1]!.segments?.map((s) => (s.kind === "text" ? s.text : s.kind))).toEqual(["第二答"]);
  });
});

// ── ql-20260822-010：去重收窄 + run 快照终态映射（历史回看一致性） ─────────

describe("logsToTurns 去重收窄（ql-20260822-010）", () => {
  it("同轮内重复 tool_result 文本不再被内容级去重误删（与实时路径一致）", () => {
    const turns = toSegmentTurns([
      makeLog("1", "run-1", "user_input", "跑两次同样的命令"),
      makeLog("2", "run-1", "tool_call", '{"tool":"Bash","args":{"command":"ls"},"success":true}'),
      makeLog("3", "run-1", "stdout", "[TOOL_RESULT] same output"),
      makeLog("4", "run-1", "tool_call", '{"tool":"Bash","args":{"command":"ls"},"success":true}'),
      makeLog("5", "run-1", "stdout", "[TOOL_RESULT] same output"),
    ]);
    expect(turns).toHaveLength(1);
    const results = turns[0]!.segments
      ?.map((s) => (s.kind === "tool" ? (s.result ?? null) : null))
      .filter((t): t is string => t !== null);
    // 收窄前第二条 "[TOOL_RESULT] same output" 会被 seenText（kind:text 键）丢掉
    // → 刷新后工具结果变少，与实时 SSE 路径不一致。
    expect(results).toEqual(["same output", "same output"]);
  });

  it("防御性去重保留：完全重复的 user_input 仍只计一次 prompt", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "帮我看看"),
      makeLog("2", "run-1", "user_input", "帮我看看"),
    ]);
    expect(turns[0]!.prompt).toBe("帮我看看");
  });

  it("ql-20260825-002：同主体 marker 版 + 裸文本版（首句双提交存量）归并为一条，marker 版优先", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "[附件:11111111-1111-1111-1111-111111111111|file|准备材料.doc]\n分析一下"),
      makeLog("2", "run-1", "user_input", "分析一下"),
    ]);
    // 归并后 prompt 只剩 marker 版（chips 回显数据源），不出现「分析一下 分析一下」。
    expect(turns[0]!.prompt).toBe(
      "[附件:11111111-1111-1111-1111-111111111111|file|准备材料.doc]\n分析一下",
    );
  });

  it("ql-20260825-002：marker 版后到时同样归并（顺序无关）", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "分析一下"),
      makeLog("2", "run-1", "user_input", "[附件:11111111-1111-1111-1111-111111111111|image|图.png]\n分析一下"),
    ]);
    expect(turns[0]!.prompt).toBe(
      "[附件:11111111-1111-1111-1111-111111111111|image|图.png]\n分析一下",
    );
  });

  it("ql-20260825-002：用户真实连发不同消息不并组（各自保留）", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "第一条"),
      makeLog("2", "run-1", "user_input", "第二条"),
    ]);
    expect(turns[0]!.prompt).toBe("第一条\n第二条");
  });

  it("ql-20260825-002：纯附件双提交（空主体）归并为一条 marker 版", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "[附件:11111111-1111-1111-1111-111111111111|image|图.png]"),
      makeLog("2", "run-1", "user_input", "[附件:11111111-1111-1111-1111-111111111111|image|图.png]"),
    ]);
    // 完全相同的两条先被 seenText 精确去重（既有行为），保留一条 marker 版。
    expect(turns[0]!.prompt).toBe(
      "[附件:11111111-1111-1111-1111-111111111111|image|图.png]",
    );
  });
});

describe("runTerminalTurnStatus（ql-20260822-010）", () => {
  it("failed → failed；interrupted/cancelled → killed；正常状态 → null", () => {
    expect(runTerminalTurnStatus("failed")).toBe("failed");
    expect(runTerminalTurnStatus("interrupted")).toBe("killed");
    expect(runTerminalTurnStatus("cancelled")).toBe("killed");
    expect(runTerminalTurnStatus("completed")).toBeNull();
    expect(runTerminalTurnStatus("running")).toBeNull();
    expect(runTerminalTurnStatus("pending")).toBeNull();
    expect(runTerminalTurnStatus(null)).toBeNull();
  });
});
