// ql-20260617-011：normalize 合并连续 [THINKING] delta 测试。
// daemon 每个 thinking_delta 推一条 stdout log（`[THINKING] <token>`），
// 前端提取 token 文本（去 `[THINKING] ` 前缀），按原序拼接成完整段落。
// 同一条 message 的 thinking_delta 直接 "" 拼接（delta 已含必要空格）。
import { describe, it, expect } from "vitest";
import {
  normalizeLogs,
  isThinkingOnly,
  isThinkingContent,
  isAssistantOnly,
  mergeAssistantPiece,
  mergeThinkingPiece,
} from "../normalize";
import type { AgentRunLogEntry } from "@/lib/agent";

function makeLog(
  channel: AgentRunLogEntry["channel"],
  content: string,
  id: string,
  timestamp = "2026-06-17T13:54:38.000Z",
): AgentRunLogEntry {
  return {
    id,
    run_id: "run-1",
    channel,
    content_redacted: content,
    timestamp,
    sequence: 0,
  } as AgentRunLogEntry;
}

describe("isThinkingOnly (ql-20260617-011 / ql-20260617-013)", () => {
  it("首行为 [THINKING] 前缀返回 true（chunk 内部可含换行）", () => {
    expect(isThinkingOnly("[THINKING] 用户要求")).toBe(true);
    expect(isThinkingOnly("[THINKING] 第一行\n第二行不是前缀")).toBe(true);
    expect(isThinkingOnly("[THINKING] chunk\n\n含多行\n原文")).toBe(true);
  });

  it("空字符串返回 false", () => {
    expect(isThinkingOnly("")).toBe(false);
  });

  it("含 [SYSTEM] / [ASSISTANT] 首行返回 false", () => {
    expect(isThinkingOnly("[SYSTEM:init] session=x")).toBe(false);
    expect(isThinkingOnly("[ASSISTANT] foo")).toBe(false);
  });

  it("普通 stdout 返回 false", () => {
    expect(isThinkingOnly("Running scan...")).toBe(false);
  });
});

describe("isThinkingContent (兼容性回归)", () => {
  it("[THINKING] / [SYSTEM] 视为 thinking content；纯 [ASSISTANT] 不算", () => {
    expect(isThinkingContent("[THINKING] x")).toBe(true);
    expect(isThinkingContent("[SYSTEM:init] y")).toBe(true);
    expect(isThinkingContent("[ASSISTANT] z")).toBe(false);
  });
});

describe("normalizeLogs：连续 [THINKING] 合并 (ql-20260617-011)", () => {
  it("英文 token 拼接成完整段落（去掉 `[THINKING] ` 前缀，无分隔符）", () => {
    // daemon 每个 thinking_delta 推一条 log，delta content 已含前导空格如 " user"
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] The", "l1", "2026-06-17T13:54:43.000Z"),
      makeLog("stdout", "[THINKING]  user", "l2", "2026-06-17T13:54:54.000Z"),
      makeLog("stdout", "[THINKING]  wants", "l3", "2026-06-17T13:54:54.001Z"),
      makeLog("stdout", "[THINKING]  me", "l4", "2026-06-17T13:54:54.002Z"),
    ];

    const result = normalizeLogs(logs);

    expect(result).toHaveLength(4);
    expect(result[0]?.hidden).toBe(false);
    // 首条 mergedThinkingContent = "The" + " user" + " wants" + " me"
    expect(result[0]?.mergedThinkingContent).toBe("The user wants me");
    expect(result[1]?.hidden).toBe(true);
    expect(result[2]?.hidden).toBe(true);
    expect(result[3]?.hidden).toBe(true);
  });

  it("中文 token（无空格）也能正确拼接还原", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 用户", "l1"),
      makeLog("stdout", "[THINKING] 要求", "l2"),
      makeLog("stdout", "[THINKING] 按照", "l3"),
      makeLog("stdout", "[THINKING] 项目", "l4"),
    ];

    const result = normalizeLogs(logs);

    expect(result[0]?.hidden).toBe(false);
    expect(result[0]?.mergedThinkingContent).toBe("用户要求按照项目");
    expect(result[1]?.hidden).toBe(true);
    expect(result[2]?.hidden).toBe(true);
    expect(result[3]?.hidden).toBe(true);
  });

  it("单条 [THINKING] 也设置 mergedThinkingContent（提取 token 文本）", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 单独一条", "l1"),
    ];

    const result = normalizeLogs(logs);

    expect(result[0]?.hidden).toBe(false);
    // 单条也要提取文本（去掉 `[THINKING] ` 前缀）
    expect(result[0]?.mergedThinkingContent).toBe("单独一条");
  });

  it("中间出现 [SYSTEM] 行断开连续性，下次 [THINKING] 重新起始块", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 块1a", "l1"),
      makeLog("stdout", "[THINKING] 块1b", "l2"),
      // [SYSTEM] 是非 thinking-only stdout → 断开
      makeLog("stdout", "[SYSTEM:status] heartbeat", "l3"),
      makeLog("stdout", "[THINKING] 块2a", "l4"),
      makeLog("stdout", "[THINKING] 块2b", "l5"),
    ];

    const result = normalizeLogs(logs);

    // l1 是块 1 首条
    expect(result[0]?.hidden).toBe(false);
    expect(result[0]?.mergedThinkingContent).toBe("块1a块1b");
    // l2 合并到 l1
    expect(result[1]?.hidden).toBe(true);
    // l3 不 hidden（含 [SYSTEM] → isThinkingOnly=false → 不进入合并分支）
    expect(result[2]?.hidden).toBe(false);
    expect(result[2]?.mergedThinkingContent).toBeUndefined();
    // l4 是块 2 首条
    expect(result[3]?.hidden).toBe(false);
    expect(result[3]?.mergedThinkingContent).toBe("块2a块2b");
    // l5 合并到 l4
    expect(result[4]?.hidden).toBe(true);
  });

  it("tool_call 断开连续性", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 工具前思考", "l1"),
      makeLog("tool_call", '{"tool":"Bash"}', "t1"),
      makeLog("stdout", "[THINKING] 工具后思考", "l3"),
    ];

    const result = normalizeLogs(logs);

    // l1 不合并到 l3
    expect(result[0]?.mergedThinkingContent).toBe("工具前思考");
    expect(result[2]?.mergedThinkingContent).toBe("工具后思考");
    expect(result[0]?.hidden).toBe(false);
    expect(result[2]?.hidden).toBe(false);
  });

  it("空 stdout 不参与合并", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 实质", "l1"),
      makeLog("stdout", "", "l2"), // 全是空行
      makeLog("stdout", "[THINKING] 实质2", "l3"),
    ];

    const result = normalizeLogs(logs);

    expect(result[0]?.mergedThinkingContent).toBe("实质实质2");
    expect(result[1]?.hidden).toBe(false); // 空 stdout 本身就不 hidden（无害）
    expect(result[2]?.hidden).toBe(true);
  });

  it("[TOOL_USE] 后的 [THINKING] 应起始新块（不被合并到 tool）", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[TOOL_USE] Bash {\"command\":\"ls\"}", "t1"),
      makeLog("stdout", "[THINKING] 想想", "l2"),
    ];

    const result = normalizeLogs(logs);

    expect(result[0]?.hidden).toBe(false);
    expect(result[1]?.hidden).toBe(false);
    expect(result[1]?.mergedThinkingContent).toBe("想想");
  });

  it("ql-20260617-013 一条 stdout 首行 [THINKING] + 内部换行的 chunk 整体提取", () => {
    // daemon thinking_delta 节流后单条 stdout 只有首行带 [THINKING] 前缀，
    // chunk 内部含原文换行（不再每行都重新加前缀）。
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] Hello\n world", "l1"),
    ];

    const result = normalizeLogs(logs);

    expect(result[0]?.mergedThinkingContent).toBe("Hello\n world");
  });

  it("ql-20260617-013 chunk 内部含换行（80 字符累积）也能合并", () => {
    // daemon thinking_delta 节流后单条 stdout chunk 可含原文换行
    //（如 `[THINKING] 路径运行...:\n\n1. init 已经完成...`）
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 现在我看到源代码目录的结构了。我需要使用这个实际", "l1"),
      makeLog("stdout", "[THINKING] 路径运行 sillyspec scan。根据 sillyspec 的工作流程：\n\n1. init 已经完成（.sillyspec 目录已存在）\n2", "l2"),
      makeLog("stdout", "[THINKING] . 现在需要运行 scan\n\n让我直接运行 scan 命令。", "l3"),
    ];

    const result = normalizeLogs(logs);

    // 3 条都应被识别为 thinking chunk，合并到首条
    expect(result[0]?.hidden).toBe(false);
    expect(result[1]?.hidden).toBe(true);
    expect(result[2]?.hidden).toBe(true);
    // 合并内容应保留所有 chunk 的原文（含换行）
    expect(result[0]?.mergedThinkingContent).toBe(
      "现在我看到源代码目录的结构了。我需要使用这个实际"
      + "路径运行 sillyspec scan。根据 sillyspec 的工作流程：\n\n1. init 已经完成（.sillyspec 目录已存在）\n2"
      + ". 现在需要运行 scan\n\n让我直接运行 scan 命令。",
    );
  });

  it("ql-20260617-013 isThinkingOnly 只检查首行前缀", () => {
    // 直接测试函数行为：chunk 含换行也视为 thinking-only
    expect(isThinkingOnly("[THINKING] 简单")).toBe(true);
    expect(isThinkingOnly("[THINKING] 首行\n第二行\n第三行")).toBe(true);
    expect(isThinkingOnly("  [THINKING] 带前导空白")).toBe(true);
    expect(isThinkingOnly("[SYSTEM:init] x")).toBe(false);
    expect(isThinkingOnly("[ASSISTANT] x")).toBe(false);
    expect(isThinkingOnly("普通 stdout")).toBe(false);
  });
});

describe("assistant stream merge (ql-20260618-012)", () => {
  it("mergeAssistantPiece 追加 delta 并去重 cumulative 全文", () => {
    expect(mergeAssistantPiece("先", "读取")).toBe("先读取");
    expect(mergeAssistantPiece("先读取", "先读取完整句子")).toBe("先读取完整句子");
  });

  it("mergeAssistantPiece 去重重复段落并用换行拼接不同句", () => {
    const line = "查看项目现有 sillyspec 配置与 CLI 用法。";
    expect(mergeAssistantPiece(line, line)).toBe(line);
    const prev = "先读取工作流说明。";
    expect(mergeAssistantPiece(prev, line)).toBe(`${prev}\n${line}`);
  });

  it("连续 [ASSISTANT] stdout 合并为一条 mergedAssistantContent", () => {
    const logs = [
      makeLog("stdout", "[ASSISTANT] 先", "a1"),
      makeLog("stdout", "[ASSISTANT] 读取", "a2"),
      makeLog("stdout", "[ASSISTANT] 项目", "a3"),
    ];
    const result = normalizeLogs(logs);
    expect(result.filter((r) => !r.hidden)).toHaveLength(1);
    expect(result[0]?.mergedAssistantContent).toBe("先读取项目");
    expect(result[1]?.hidden).toBe(true);
    expect(result[2]?.hidden).toBe(true);
  });

  it("isAssistantOnly 识别 [ASSISTANT] 片段", () => {
    expect(isAssistantOnly("[ASSISTANT] hello")).toBe(true);
    expect(isAssistantOnly("[SYSTEM:init] x")).toBe(false);
  });
});

describe("normalizeLogs：非字符串 content 防御 (ql-20260620)", () => {
  it("content_redacted 为 number/object/null 时不抛 TypeError，逐条保留", () => {
    // 后端 schema 声明 str|None，但 SSE 偶发推送 number/object 等非字符串。
    // 修复前任意一处 .split("\n") 会抛 TypeError 让整页崩成 client-side exception；
    // 现在入口 asString 归一化（number→String，object→String，null→""）。
    const logs = [
      { id: "n1", run_id: "run-1", channel: "stdout", content_redacted: 12345, timestamp: "2026-06-20T00:00:00.000Z", sequence: 0 },
      { id: "n2", run_id: "run-1", channel: "stdout", content_redacted: { foo: "bar" }, timestamp: "2026-06-20T00:00:01.000Z", sequence: 1 },
      { id: "n3", run_id: "run-1", channel: "stdout", content_redacted: null, timestamp: "2026-06-20T00:00:02.000Z", sequence: 2 },
    ] as unknown as AgentRunLogEntry[];

    expect(() => normalizeLogs(logs)).not.toThrow();
    const result = normalizeLogs(logs);
    expect(result).toHaveLength(3);
    // number 被归一化为字符串后仍作为内容保留（不丢失、不抛错）
    expect(result[0]?.mergedAssistantContent).toContain("12345");
  });
});

// ============================================================================
// task-14 / FR-09 / D-002@v1：tool_use_id 全局配对 + thinking 跨断点去重
//
// task-13 已让 tool_call JSON 携带 tool_use_id 字段（snake_case，仅非空时出现）。
// stdout [TOOL_USE] 文本格式不变（`[TOOL_USE] Name: args`，不带 id —— submit_messages
// 不保留 metadata）。故前端配对策略：tool_call JSON 带 id 时建 Map<toolUseId, idx>；
// stdout [TOOL_USE] 按 tool 名 + 时间戳邻近（扩大窗口）合并到最近的 tool_call。
// 退化：id 缺失时回退原 ±3 窗口（向后兼容旧日志）。
// ============================================================================

describe("task-14: tool_use_id 全局配对 (FR-09)", () => {
  it("带 tool_use_id 的 tool_call JSON 与远距离 stdout [TOOL_USE] 合并为单卡（窗口 > ±3）", () => {
    // 实际 daemon emit 顺序：stdout [TOOL_USE] 在前，tool_call JSON 紧随其后（相邻）。
    // 本测试构造"距离 > 3"场景：两者中间穿插 5 条无关 [ASSISTANT] stdout。
    // task-13 产出 tool_call JSON 带 tool_use_id；stdout 不带 id → 靠 tool 名 + 扩大窗口配对。
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", '[TOOL_USE] Bash: ls', "tu1", "t1"),
      makeLog("stdout", "[ASSISTANT] 正在执行", "a1", "t2"),
      makeLog("stdout", "[ASSISTANT] 请稍候", "a2", "t3"),
      makeLog("stdout", "[ASSISTANT] 等待", "a3", "t4"),
      makeLog("stdout", "[ASSISTANT] 继续", "a4", "t5"),
      makeLog("stdout", "[ASSISTANT] 完成", "a5", "t6"),
      // tool_call JSON 带 tool_use_id，距离 stdout [TOOL_USE] 已 > 3，旧 ±3 窗口漏合并
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", args: { command: "ls" }, tool_use_id: "toolu_001", timestamp: "t7", status: "allowed", success: true }),
        "tc1",
        "t7",
      ),
    ];
    const result = normalizeLogs(logs);
    const visible = result.filter((p) => !p.hidden);
    // 期望：stdout [TOOL_USE] 与 tool_call JSON 合并，只渲染一张 tool 卡
    const toolCards = visible.filter((p) => p.log.id === "tc1" || p.log.id === "tu1");
    expect(toolCards.length).toBe(1);
    // tool_call JSON 是主卡（带 id），stdout [TOOL_USE] 被 hidden
    expect(toolCards[0]?.log.id).toBe("tc1");
    expect(toolCards[0]?.toolUseId).toBe("toolu_001");
    // stdout [TOOL_USE] 被合并隐藏
    const tuEntry = result.find((p) => p.log.id === "tu1");
    expect(tuEntry?.hidden).toBe(true);
  });

  it("tool_use_id 缺失时退化到 ±3 窗口启发式（向后兼容旧 daemon 日志）", () => {
    // 旧 daemon：tool_call JSON 不含 tool_use_id 字段。相邻（≤3）仍按窗口合并。
    const logs: AgentRunLogEntry[] = [
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", args: { command: "ls" }, timestamp: "t1", status: "allowed", success: true }),
        "tc1",
        "t1",
      ),
      makeLog("stdout", '[TOOL_USE] Bash: ls', "tu1", "t2"),
    ];
    const result = normalizeLogs(logs);
    const visible = result.filter((p) => !p.hidden);
    // 无 id 时仍按 ±3 窗口合并 → stdout [TOOL_USE] 被 hidden
    expect(visible.some((p) => p.log.id === "tu1")).toBe(false);
    expect(visible.some((p) => p.log.id === "tc1")).toBe(true);
  });

  it("tool_use_id 缺失且距离 > ±3 时保留双卡（启发式无法覆盖，不错误合并）", () => {
    // 无 id + 远距离：不能错误地把不相关的 stdout 合并到 tool_call。
    // 此场景接受双卡（设计退化：id 缺失时偶发漏配对）。
    const logs: AgentRunLogEntry[] = [
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", args: { command: "ls" }, timestamp: "t1", status: "allowed", success: true }),
        "tc1",
        "t1",
      ),
      makeLog("stdout", "[ASSISTANT] 中间1", "a1", "t2"),
      makeLog("stdout", "[ASSISTANT] 中间2", "a2", "t3"),
      makeLog("stdout", "[ASSISTANT] 中间3", "a3", "t4"),
      makeLog("stdout", "[ASSISTANT] 中间4", "a4", "t5"),
      makeLog("stdout", '[TOOL_USE] Bash: ls', "tu1", "t6"),
    ];
    const result = normalizeLogs(logs);
    // 无 id 且距离 > 3 → 不合并，两张卡都保留（接受漏配对，不错误合并）
    const tuEntry = result.find((p) => p.log.id === "tu1");
    expect(tuEntry?.hidden).toBe(false);
  });

  it("孤儿 [TOOL_RESULT]（无匹配 tool_use）独立渲染不隐藏", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", '[TOOL_RESULT] 残留结果', "tr1"),
    ];
    const result = normalizeLogs(logs);
    expect(result[0]?.hidden).toBe(false);
    expect(result[0]?.parsedToolResult).toBe("残留结果");
  });

  it("同一 tool_use_id 的重复 tool_call JSON 去重（保留首张，result 合并）", () => {
    // 理论上同 id 不应重复 emit，防御性：daemon 重试/重放场景。
    const logs: AgentRunLogEntry[] = [
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", args: { command: "ls" }, tool_use_id: "toolu_dup", timestamp: "t1", status: "allowed", success: true }),
        "tc1",
        "t1",
      ),
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", args: { command: "ls" }, tool_use_id: "toolu_dup", timestamp: "t2", status: "allowed", success: true }),
        "tc2",
        "t2",
      ),
    ];
    const result = normalizeLogs(logs);
    const visible = result.filter((p) => !p.hidden && p.log.channel === "tool_call");
    expect(visible.length).toBe(1);
    expect(visible[0]?.log.id).toBe("tc1");
    expect(result.find((p) => p.log.id === "tc2")?.hidden).toBe(true);
  });

  it("tool_use_id 配对后 [TOOL_RESULT] 合并进对应卡片（非邻近）", () => {
    // tool_call 带 id，result 距离 > 3，靠 id 关联合并。
    // 注：result 行当前不带 id（task-13 非目标），故仍靠 tool 名 + 邻近启发式。
    // 但若 result 紧邻 tool_call（同卡），应合并。
    const logs: AgentRunLogEntry[] = [
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", args: { command: "ls" }, tool_use_id: "toolu_r1", timestamp: "t1", status: "allowed", success: true }),
        "tc1",
        "t1",
      ),
      makeLog("stdout", '[TOOL_RESULT] file1.txt\nfile2.txt', "tr1", "t2"),
    ];
    const result = normalizeLogs(logs);
    const tc = result.find((p) => p.log.id === "tc1");
    expect(tc?.mergedToolResult).toContain("file1.txt");
    expect(result.find((p) => p.log.id === "tr1")?.hidden).toBe(true);
  });
});

describe("task-14: mergeThinkingPiece 增量段 vs 完整段去重 (D1/D2)", () => {
  it("完全相同时去重（返回原值）", () => {
    expect(mergeThinkingPiece("同一段", "同一段")).toBe("同一段");
  });

  it("piece 是 prev 的前缀扩展且明显更长（完整段覆盖 partial，D2 场景）→ 返回 piece", () => {
    // D2 根因：partial 累积到首句，完整段重发整段（首句 + 后续多句 + 换行）。
    // piece 明显更长（含换行 + 多句），触发完整段覆盖去重。
    const prev = "我先分析项目结构。";
    const piece = "我先分析项目结构。然后运行 scan 命令。\n最后检查文档完整性。";
    expect(mergeThinkingPiece(prev, piece)).toBe(piece);
  });

  it("prev 是 piece 的前缀扩展且明显更长 → 返回 prev（对称场景）", () => {
    const piece = "我先分析项目结构。";
    const prev = "我先分析项目结构。然后运行 scan 命令。\n最后检查文档完整性。";
    expect(mergeThinkingPiece(prev, piece)).toBe(prev);
  });

  it("短 delta 前缀包含不误判去重（保留 delta 直接拼接）", () => {
    // "实质" 是 "实质2" 的前缀，但两者是独立 delta（ql-20260617-011 场景）。
    // 不触发完整段去重，直接拼成 "实质实质2"。
    expect(mergeThinkingPiece("实质", "实质2")).toBe("实质实质2");
    expect(mergeThinkingPiece("The", "There")).toBe("TheThere");
  });

  it("无前缀关系的增量段按原序拼接（保留现有行为）", () => {
    expect(mergeThinkingPiece("Hello", " World")).toBe("Hello World");
    expect(mergeThinkingPiece("The", " user")).toBe("The user");
  });

  it("空 prev 返回 piece，空 piece 返回 prev", () => {
    expect(mergeThinkingPiece("", "x")).toBe("x");
    expect(mergeThinkingPiece("x", "")).toBe("x");
  });
});

describe("task-14: thinking 跨断点去重（normalize 集成）", () => {
  it("thinking 合并使用 mergeThinkingPiece 避免完整段双份（D2 场景）", () => {
    // 模拟 D2 根因：partial 累积首句，完整 assistant message 重发整段（多句 + 换行）。
    // 旧逻辑（直接 prev + piece）会得到 "首句首句 + 后续" —— 双份。
    // 新逻辑（mergeThinkingPiece）识别前缀包含且明显更长，返回完整段。
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 我先分析项目结构。", "t1"),
      makeLog("stdout", "[THINKING] 我先分析项目结构。然后运行 scan 命令。\n最后检查文档完整性。", "t2"),
    ];
    const result = normalizeLogs(logs);
    expect(result[0]?.mergedThinkingContent).toBe(
      "我先分析项目结构。然后运行 scan 命令。\n最后检查文档完整性。",
    );
    expect(result[1]?.hidden).toBe(true);
  });

  it("现有相邻 thinking delta 拼接行为不破坏（无前缀关系时原序拼接）", () => {
    // ql-20260617-011 回归：英文 token delta 拼接
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] The", "l1"),
      makeLog("stdout", "[THINKING]  user", "l2"),
      makeLog("stdout", "[THINKING]  wants", "l3"),
    ];
    const result = normalizeLogs(logs);
    expect(result[0]?.mergedThinkingContent).toBe("The user wants");
  });

  it("segmentId 缺失时保持现有相邻合并行为（断点处重置）", () => {
    // 当前 daemon stream-json 未提供稳定 segment_id（task-11/12 信号未完全接通），
    // 故跨 [TOOL_USE] 断点的 thinking 不合并到原段（接受退化，遵循 lastThinkingIdx 重置）。
    // 本测试锁定当前行为，待 segmentId 信号就位后 task-15 再放开。
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 段1a", "t1"),
      makeLog("stdout", '[TOOL_USE] Bash: ls', "tu1"),
      makeLog("stdout", "[THINKING] 段2a", "t2"),
    ];
    const result = normalizeLogs(logs);
    // 两段 thinking 各自独立（segmentId 缺失 → 不跨断点合并）
    const visibleThinking = result.filter((p) => !p.hidden && p.mergedThinkingContent);
    expect(visibleThinking.length).toBe(2);
    expect(result[0]?.mergedThinkingContent).toBe("段1a");
    expect(result[2]?.mergedThinkingContent).toBe("段2a");
  });
});

describe("tool_result 按 parent_tool_use_id 精确配对 (2026-07-09-agent-log-display-fix / D-007)", () => {
  it("stdout [TOOL_RESULT] + parent_tool_use_id 命中 → 合并进 tool_call 卡片并 hidden", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog(
        "tool_call",
        JSON.stringify({ tool: "Bash", tool_use_id: "call_001", args: { command: "ls" } }),
        "tc1",
      ),
      {
        ...makeLog("stdout", "[TOOL_RESULT] file1.txt\nfile2.txt", "tr1"),
        parent_tool_use_id: "call_001",
      },
    ];
    const result = normalizeLogs(logs);
    // tool_call 卡片（tc1）接收 mergedToolResult
    expect(result[0]?.mergedToolResult).toBeTruthy();
    // result 行（tr1）hidden（已合并进卡片）
    const tr = result.find((p) => p.log.id === "tr1");
    expect(tr?.hidden).toBe(true);
  });

  it("parent_tool_use_id 缺失 → 退化到 lastToolSourceIdx 启发式（兼容旧日志）", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("tool_call", JSON.stringify({ tool: "Bash", args: { command: "ls" } }), "tc1"),
      makeLog("stdout", "[TOOL_RESULT] output", "tr1"),
    ];
    const result = normalizeLogs(logs);
    const tr = result.find((p) => p.log.id === "tr1");
    // 无 id 但紧邻 tool_call → 退化合并（现有行为不变）
    expect(tr?.hidden).toBe(true);
  });
});
