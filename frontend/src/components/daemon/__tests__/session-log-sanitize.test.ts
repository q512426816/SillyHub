/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004 / task-09:
 * sanitizeSessionLogContent 纯函数单测。
 *
 * 覆盖 thinking/SYSTEM/AskUserQuestion/TOOL_RESULT 标记过滤 + stderr/tool_call
 * 前缀 + [ASSISTANT|THINKING|LOG:\w+] 剥前缀 + 空内容。修复 attach 历史消息
 * 渲染 BUG（logsToTurns 与 renderLogContent 共用此函数）。
 */

import { describe, it, expect } from "vitest";

import { classifySessionLog, extractDialogQA, sanitizeSessionLogContent, statusFromToolUseRaw } from "../session-log-sanitize";

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

  // 2026-08-03-session-stream-partial-revoke / FR-04 / R-04：override 撤回令箭前缀
  // 不泄漏到正文（防御性：attach 历史路径万一收到 override 文本，sanitize 兜底丢弃）。
  it("[ASSISTANT_OVERRIDE] 前缀 → 丢弃（不泄漏撤回信号到正文）", () => {
    expect(sanitizeSessionLogContent("[ASSISTANT_OVERRIDE] main:msg_abc:1")).toBe("");
  });

  it("[THINKING_OVERRIDE] 前缀 → 丢弃", () => {
    expect(sanitizeSessionLogContent("[THINKING_OVERRIDE] tu_xyz:2")).toBe("");
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

  it("channel=tool_call → tool_use（不加前缀，前缀由展示层决定；配对用 result）", () => {
    expect(classifySessionLog("Read file.ts", "tool_call")).toEqual({
      kind: "tool_use",
      text: "Read file.ts",
    });
  });

  it("stdout 的 [TOOL_USE] 文本行 → 丢弃（与 tool_call JSON 重复，双发去重）", () => {
    // ql-20260730-003 修正：daemon 双发 [TOOL_USE] 文本 + tool_call JSON，丢弃文本行以
    // tool_call JSON 为权威源，避免 tool_use 翻倍致 result 配对半数落空、永显「执行中」。
    expect(classifySessionLog('[TOOL_USE] Read: {"file_path": "a.ts"}', "stdout")).toBeNull();
  });

  it("stdout 的 [TOOL_RESULT] 结果行 → tool_result 剥前缀（供配对最近 tool_use）", () => {
    expect(classifySessionLog("[TOOL_RESULT] 文件内容如下", "stdout")).toEqual({
      kind: "tool_result",
      text: "文件内容如下",
    });
  });

  it("无 channel（null）的 [TOOL_USE] → 丢弃（双发去重），[TOOL_RESULT] → tool_result", () => {
    expect(classifySessionLog("[TOOL_USE] Glob: x", null)).toBeNull();
    expect(classifySessionLog("[TOOL_RESULT] done", null)).toEqual({
      kind: "tool_result",
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

  // 2026-08-03-session-stream-partial-revoke / FR-04 / D-002@v1：override 撤回令箭识别。
  // classifySessionLog 把 [ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 前缀识别为 kind=override，
  // 解析 segmentId（捕获组2）+ variant（assistant/thinking），供 task-06 onLog 精确撤回。
  it("[ASSISTANT_OVERRIDE] → override + segmentId + variant=assistant", () => {
    expect(classifySessionLog("[ASSISTANT_OVERRIDE] main:msg_abc:1")).toEqual({
      kind: "override",
      segmentId: "main:msg_abc:1",
      variant: "assistant",
      text: "",
    });
  });

  it("[THINKING_OVERRIDE] → override + segmentId + variant=thinking", () => {
    expect(classifySessionLog("[THINKING_OVERRIDE] tu_xyz:2")).toEqual({
      kind: "override",
      segmentId: "tu_xyz:2",
      variant: "thinking",
      text: "",
    });
  });

  it("[THINKING_OVERRIDE] 不被 [THINKING] 分支误吞（返回 override 而非 thinking）", () => {
    // 关键约束：override 分支必须在 [THINKING] 之前，否则 [THINKING_OVERRIDE] 的
    // [THINKING] 前缀正则会先命中、丢掉 _OVERRIDE 语义、错判为 thinking。
    const result = classifySessionLog("[THINKING_OVERRIDE] seg:1");
    expect(result?.kind).toBe("override");
    expect(result?.kind).not.toBe("thinking");
  });
});

/**
 * ql-20260730-003 修正：statusFromToolUseRaw 从 tool_call JSON 的 success 字段定状态徽章
 * （权威源，不再靠 [TOOL_RESULT] 文本关键词猜测）。
 */
describe("statusFromToolUseRaw", () => {
  it("success: true → ok（✓）", () => {
    expect(statusFromToolUseRaw('{"tool":"Bash","success":true}')).toBe("ok");
  });
  it("success: false → deny（✗）", () => {
    expect(statusFromToolUseRaw('{"tool":"Bash","success":false}')).toBe("deny");
  });
  it("无 success 字段 → running（回退靠后续 result 配对兜底）", () => {
    expect(statusFromToolUseRaw('{"tool":"Bash","args":{}}')).toBe("running");
  });
  it("非 JSON（人类可读摘要）→ running", () => {
    expect(statusFromToolUseRaw("Read: file.ts")).toBe("running");
  });
  it("空串 → running", () => {
    expect(statusFromToolUseRaw("")).toBe("running");
  });
});

describe("extractDialogQA", () => {
  it("解析 AskUserQuestion 问题+回答配对（无 options → options 空，answerText 兜底）", () => {
    const result = extractDialogQA({
      dialog_payload: { questions: [{ question: "用 A 还是 B?" }, { question: "几号?" }] },
      answer: { answers: [{ answer: "A" }, { answer: "3" }] },
    });
    expect(result).toEqual([
      { question: "用 A 还是 B?", options: [], answerText: "A" },
      { question: "几号?", options: [], answerText: "3" },
    ]);
  });

  it("ql-20260802-003：提取全部 options 并标记选中项（answer===option.label）", () => {
    const result = extractDialogQA({
      dialog_payload: {
        questions: [
          {
            question: "写哪？",
            options: [
              { label: "桌面 (Recommended)", description: "桌面路径" },
              { label: "主目录", description: "主目录路径" },
              { label: "工作目录" },
            ],
          },
        ],
      },
      answer: { answers: [{ answer: "桌面 (Recommended)" }] },
    });
    expect(result).toEqual([
      {
        question: "写哪？",
        options: [
          { label: "桌面 (Recommended)", description: "桌面路径", selected: true },
          { label: "主目录", description: "主目录路径", selected: false },
          { label: "工作目录", description: undefined, selected: false },
        ],
        answerText: "桌面 (Recommended)",
      },
    ]);
  });

  it("未回答（answer 缺失）→ options 全未选，answerText=null", () => {
    const result = extractDialogQA({
      dialog_payload: { questions: [{ question: "Q", options: [{ label: "x" }] }] },
      answer: null,
    });
    expect(result).toEqual([
      {
        question: "Q",
        options: [{ label: "x", description: undefined, selected: false }],
        answerText: null,
      },
    ]);
  });

  it("无 questions → 空数组（调用方据此跳过渲染）", () => {
    expect(extractDialogQA({ dialog_payload: null, answer: null })).toEqual([]);
  });

  it("结构异常兜底（无问题文本 → 占位）", () => {
    const result = extractDialogQA({
      dialog_payload: { questions: [{}] },
      answer: { answers: [] },
    });
    expect(result).toEqual([{ question: "(无问题文本)", options: [], answerText: null }]);
  });
});
