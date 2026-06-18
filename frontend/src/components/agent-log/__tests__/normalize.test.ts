// ql-20260617-011：normalize 合并连续 [THINKING] delta 测试。
// daemon 每个 thinking_delta 推一条 stdout log（`[THINKING] <token>`），
// 前端提取 token 文本（去 `[THINKING] ` 前缀），按原序拼接成完整段落。
// 同一条 message 的 thinking_delta 直接 "" 拼接（delta 已含必要空格）。
import { describe, it, expect } from "vitest";
import { normalizeLogs, isThinkingOnly, isThinkingContent, isAssistantOnly, mergeAssistantPiece } from "../normalize";
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
