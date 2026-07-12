/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004 / task-09:
 * sanitizeSessionLogContent 纯函数单测。
 *
 * 覆盖 thinking/SYSTEM/AskUserQuestion/TOOL_RESULT 标记过滤 + stderr/tool_call
 * 前缀 + [ASSISTANT|THINKING|LOG:\w+] 剥前缀 + 空内容。修复 attach 历史消息
 * 渲染 BUG（logsToTurns 与 renderLogContent 共用此函数）。
 */

import { describe, it, expect } from "vitest";

import { sanitizeSessionLogContent } from "../session-log-sanitize";

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

  it("tool_call 加 🔧 前缀", () => {
    expect(sanitizeSessionLogContent("Read file.ts", "tool_call")).toBe("🔧 Read file.ts");
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
