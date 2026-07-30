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

describe("logsToTurns 对话/过程分流（ql-20260729-005）", () => {
  it("reply 进 output，thinking/tool/stderr 进 details，user_input 进 prompt", () => {
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
    // details 按到达顺序保留三类过程项
    expect(turn.details).toEqual([
      { kind: "thinking", text: "先分析下结构" },
      { kind: "tool", text: "Read src/a.ts" },
      { kind: "stderr", text: "permission denied" },
    ]);
  });

  it("SYSTEM/RESULT/AskUserQuestion 行仍丢弃，不进 output 也不进 details", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", null, "[SYSTEM:thinking_tokens] 48"),
      makeLog("2", "run-1", null, "[RESULT:done] ok"),
      makeLog("3", "run-1", null, '{"tool": "AskUserQuestion"}'),
      makeLog("4", "run-1", "stdout", "正文"),
    ]);
    const turn = turns[0]!;
    expect(turn.output).toBe("正文");
    expect(turn.details).toEqual([]);
  });

  it("无过程项的 turn details 为空数组", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "user_input", "你好"),
      makeLog("2", "run-1", "stdout", "你好呀"),
    ]);
    expect(turns[0]!.details).toEqual([]);
  });

  it("跨 run 分组各自独立分流", () => {
    const turns = logsToTurns([
      makeLog("1", "run-1", "stdout", "第一轮答复"),
      makeLog("2", "run-1", "tool_call", "Read a.ts"),
      makeLog("3", "run-2", "stdout", "第二轮答复"),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.output).toBe("第一轮答复");
    expect(turns[0]!.details).toEqual([{ kind: "tool", text: "Read a.ts" }]);
    expect(turns[1]!.output).toBe("第二轮答复");
    expect(turns[1]!.details).toEqual([]);
  });
});
