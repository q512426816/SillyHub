/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004 / task-09:
 * sanitizeSessionLogContent 纯函数单测。
 *
 * 覆盖 thinking/SYSTEM/AskUserQuestion/TOOL_RESULT 标记过滤 + stderr/tool_call
 * 前缀 + [ASSISTANT|THINKING|LOG:\w+] 剥前缀 + 空内容。修复 attach 历史消息
 * 渲染 BUG（logsToTurns 与 renderLogContent 共用此函数）。
 */

import { describe, it, expect } from "vitest";

import { classifySessionLog, sanitizeSessionLogContent } from "../session-log-sanitize";

describe("sanitizeSessionLogContent", () => {
  it("过滤 [SYSTEM:thinking_tokens] 技术标记", () => {
    expect(sanitizeSessionLogContent("[SYSTEM:thinking_tokens] 48")).toBe("");
  });

  it("过滤 [RESULT...] 技术标记", () => {
    expect(sanitizeSessionLogContent("[RESULT:done] something")).toBe("");
  });

  it("剥 [THINKING] 前缀保留正文", () => {
    expect(sanitizeSessionLogContent("[THINKING] 正在思考")).toBe("正在思考");
  });

  it("剥 [ASSISTANT] 前缀保留正文", () => {
    expect(sanitizeSessionLogContent("[ASSISTANT] 你好")).toBe("你好");
  });

  it("剥 [LOG:xxx] 前缀保留正文", () => {
    expect(sanitizeSessionLogContent("[LOG:info] 消息")).toBe("消息");
  });

  it("过滤 AskUserQuestion 原始 JSON 日志", () => {
    expect(sanitizeSessionLogContent('{"tool": "AskUserQuestion", "question": "..."}')).toBe("");
  });

  it("过滤 [TOOL_RESULT] User answered", () => {
    expect(sanitizeSessionLogContent("[TOOL_RESULT] User answered: yes")).toBe("");
  });

  it("stderr 加 ⚠️ 前缀", () => {
    expect(sanitizeSessionLogContent("出错了", "stderr")).toBe("⚠️ 出错了");
  });

  it("tool_call 不再加 🔧 前缀(ql-20260730-001:tool 走 classify 分流到 toolEvents,卡片自带图标)", () => {
    expect(sanitizeSessionLogContent("Read file.ts", "tool_call")).toBe("Read file.ts");
  });

  it("空内容返回空字符串", () => {
    expect(sanitizeSessionLogContent("")).toBe("");
    expect(sanitizeSessionLogContent("   ")).toBe("");
    expect(sanitizeSessionLogContent(undefined as unknown as string)).toBe("");
  });

  it("保留干净正文不变", () => {
    expect(sanitizeSessionLogContent("你好，现在几点了？")).toBe("你好，现在几点了？");
  });

  it("trim 首尾空白", () => {
    expect(sanitizeSessionLogContent("  你好  ")).toBe("你好");
  });
});

/**
 * ql-20260729-005：classifySessionLog 分类单测（对话/过程信息分流）。
 * 与 sanitizeSessionLogContent 同一套丢弃规则，但返回 {kind, text}：
 * reply=答复正文（对话视图默认展示），thinking/tool/stderr=过程项（「全部」视图展示）。
 */
describe("classifySessionLog", () => {
  it("干净正文 → reply", () => {
    expect(classifySessionLog("你好，现在几点了？")).toEqual({
      kind: "reply",
      text: "你好，现在几点了？",
    });
  });

  it("[ASSISTANT] 前缀 → reply 剥前缀", () => {
    expect(classifySessionLog("[ASSISTANT] 你好")).toEqual({ kind: "reply", text: "你好" });
  });

  it("[LOG:xxx] 前缀 → reply 剥前缀", () => {
    expect(classifySessionLog("[LOG:info] 消息")).toEqual({ kind: "reply", text: "消息" });
  });

  it("[THINKING] 前缀 → thinking 剥前缀（不再进答复正文）", () => {
    expect(classifySessionLog("[THINKING] 正在思考")).toEqual({
      kind: "thinking",
      text: "正在思考",
    });
  });

  it("channel=tool_call → tool（不加 🔧 前缀，前缀由展示层决定）", () => {
    expect(classifySessionLog("Read file.ts", "tool_call")).toEqual({
      kind: "tool",
      text: "Read file.ts",
    });
  });

  it("stdout 的 [TOOL_USE] 文本行 → tool 剥前缀（ql-20260729-005：daemon 双发之一）", () => {
    expect(
      classifySessionLog('[TOOL_USE] Read: {"file_path": "a.ts"}', "stdout"),
    ).toEqual({ kind: "tool", text: 'Read: {"file_path": "a.ts"}' });
  });

  it("stdout 的 [TOOL_RESULT] 结果行 → tool 剥前缀（ql-20260729-005）", () => {
    expect(classifySessionLog("[TOOL_RESULT] 文件内容如下", "stdout")).toEqual({
      kind: "tool",
      text: "文件内容如下",
    });
  });

  it("无 channel（null）的 [TOOL_USE]/[TOOL_RESULT] 也归 tool", () => {
    expect(classifySessionLog("[TOOL_USE] Glob: x", null)).toEqual({
      kind: "tool",
      text: "Glob: x",
    });
    expect(classifySessionLog("[TOOL_RESULT] done", null)).toEqual({
      kind: "tool",
      text: "done",
    });
  });

  it("channel=stderr → stderr（不加 ⚠️ 前缀，前缀由展示层决定）", () => {
    expect(classifySessionLog("出错了", "stderr")).toEqual({ kind: "stderr", text: "出错了" });
  });

  it("丢弃规则与原函数一致：SYSTEM/RESULT/AskUserQuestion/TOOL_RESULT answered/空", () => {
    expect(classifySessionLog("[SYSTEM:thinking_tokens] 48")).toBeNull();
    expect(classifySessionLog("[RESULT:done] something")).toBeNull();
    expect(classifySessionLog('{"tool": "AskUserQuestion", "question": "..."}')).toBeNull();
    expect(classifySessionLog("[TOOL_RESULT] User answered: yes")).toBeNull();
    expect(classifySessionLog("")).toBeNull();
    expect(classifySessionLog("   ")).toBeNull();
  });

  it("tool_call channel 的 SYSTEM 行仍丢弃（丢弃规则优先于 channel 分流）", () => {
    expect(classifySessionLog("[SYSTEM] noise", "tool_call")).toBeNull();
  });
});
