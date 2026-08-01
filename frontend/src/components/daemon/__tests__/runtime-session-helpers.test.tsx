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
