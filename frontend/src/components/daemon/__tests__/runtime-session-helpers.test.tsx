/**
 * ql-20260729-005：logsToTurns 对话/过程信息分流单测。
 * user_input → prompt；reply → output（答复正文）；thinking/tool/stderr → details
 * （默认对话视图不展示，切「全部」后渲染）。
 */

import { describe, it, expect, vi } from "vitest";

// runtime-session-helpers.tsx 顶层 import 链含 next/navigation（InteractiveSessionChatSection
// 用 useRouter/useSearchParams），本测试只测纯函数 logsToTurns，mock 防 jsdom 下解析异常。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { logsToTurns } from "../runtime-session-helpers";
import type { AgentRunLogEntry } from "@/lib/agent";

function makeLog(
  id: string,
  runId: string,
  channel: string | null,
  content: string,
): AgentRunLogEntry {
  return {
    id,
    run_id: runId,
    channel,
    content_redacted: content,
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
    expect(turn.prompt).toBe("帮我看看这个文件");
    // output 只含答复正文（两条 reply 按到达顺序拼接）
    expect(turn.output).toBe("文件内容是这样的\n总结一下");
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

  it("success:true 时 result 文本含 fail 字样仍 ok（success 权威，不靠文本猜测）", () => {
    // 关键回归：旧实现扫 result 文本「fail」误判 ✗；现以 tool_call JSON success 为准。
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

  it("孤儿 tool_result（无配对 use）降级 raw 空 tool 项，不丢数据", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "stdout", "[TOOL_RESULT] 残留结果"),
      makeLog("2", "run-1", "stdout", "正文"),
    ]);
    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: "", result: "残留结果", status: "ok" },
    ]);
  });

  it("连续 thinking 各自独立入 processItems（合并由展示层做）；被工具打断的思考保持顺序不混", () => {
    // 数据层只按序入项（每个 [THINKING] 一个 thinking 项），连续合并是展示层 TurnDetailsList
    // 的职责。这里验证顺序：思考A → 工具 → 思考B（工具穿插其间，不一股脑合并）。
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
