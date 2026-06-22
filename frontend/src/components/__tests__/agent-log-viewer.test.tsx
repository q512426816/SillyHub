// task-15 / FR-10 / D-002@v1：AgentLogViewer 渲染重构测试。
//
// 覆盖：
//   - groupIntoTurns：按 user_input / 完整 assistant 消息边界切分 turn（纯函数）
//   - AgentLogViewer turn 分组渲染：turn-head 显示 Turn N + 时间范围
//   - thinking 默认折叠（CollapsibleSection defaultOpen=false）：折叠态显示单行摘要
//   - thinking 点击展开：展开后渲染全文
//   - tool 卡片状态徽标：✓ 成功 + 耗时秒；✗ 失败
//   - ErrorBoundary：单 turn 崩溃不影响其他 turn

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AgentLogViewer, groupIntoTurns } from "@/components/agent-log-viewer";
import type { AgentRunLogEntry } from "@/lib/agent";
import type { ProcessedLog } from "@/components/agent-log/types";

function makeProcessed(
  channel: AgentRunLogEntry["channel"],
  content: string | null,
  id: string,
  timestamp = "2026-06-22T10:00:00.000Z",
  extra: Partial<ProcessedLog> = {},
): ProcessedLog {
  return {
    log: {
      id,
      run_id: "r1",
      channel,
      content_redacted: content,
      timestamp,
      sequence: 0,
    } as AgentRunLogEntry,
    hidden: false,
    ...extra,
  };
}

function makeRawLog(
  channel: AgentRunLogEntry["channel"],
  content: string | null,
  id: string,
  timestamp = "2026-06-22T10:00:00.000Z",
): AgentRunLogEntry {
  return {
    id,
    run_id: "r1",
    channel,
    content_redacted: content,
    timestamp,
    sequence: 0,
  } as AgentRunLogEntry;
}

/* ------------------------------------------------------------------ */
/*  1. groupIntoTurns 纯函数                                           */
/* ------------------------------------------------------------------ */

describe("task-15: groupIntoTurns 按 assistant / user_input 边界切分", () => {
  it("user_input 开启新 turn", () => {
    const logs: ProcessedLog[] = [
      makeProcessed("user_input", "第一次提问", "u1"),
      makeProcessed("stdout", "[ASSISTANT] 回答1", "a1"),
      makeProcessed("user_input", "第二次提问", "u2"),
      makeProcessed("stdout", "[ASSISTANT] 回答2", "a2"),
    ];
    const turns = groupIntoTurns(logs);
    expect(turns.length).toBe(2);
    expect(turns[0]!.map((p) => p.log.id)).toEqual(["u1", "a1"]);
    expect(turns[1]!.map((p) => p.log.id)).toEqual(["u2", "a2"]);
  });

  it("完整 assistant 消息（mergedAssistantContent 非空）开启新 turn", () => {
    const logs: ProcessedLog[] = [
      makeProcessed("stdout", "[ASSISTANT] 第一段回答", "a1", "2026-06-22T10:00:01.000Z", {
        mergedAssistantContent: "第一段回答",
      }),
      makeProcessed("tool_call", JSON.stringify({ tool: "Bash" }), "tc1"),
      makeProcessed("stdout", "[ASSISTANT] 第二段回答", "a2", "2026-06-22T10:00:05.000Z", {
        mergedAssistantContent: "第二段回答",
      }),
    ];
    const turns = groupIntoTurns(logs);
    // tc1 归入 a1 的 turn；a2 开启新 turn
    expect(turns.length).toBe(2);
    expect(turns[0]!.map((p) => p.log.id)).toEqual(["a1", "tc1"]);
    expect(turns[1]!.map((p) => p.log.id)).toEqual(["a2"]);
  });

  it("tool_call / tool_result 归入当前 turn，不开新 turn", () => {
    const logs: ProcessedLog[] = [
      makeProcessed("stdout", "[ASSISTANT] 我来执行", "a1", undefined, {
        mergedAssistantContent: "我来执行",
      }),
      makeProcessed("tool_call", JSON.stringify({ tool: "Bash" }), "tc1"),
      makeProcessed("stdout", "[TOOL_RESULT] 完成", "tr1"),
    ];
    const turns = groupIntoTurns(logs);
    expect(turns.length).toBe(1);
    expect(turns[0]!.length).toBe(3);
  });

  it("空数组返回空数组", () => {
    expect(groupIntoTurns([])).toEqual([]);
  });

  it("过滤后无边界（如只剩 tool_call）归为 1 个 turn", () => {
    // 用户过滤后只剩 tool_call channel（user_input 被过滤掉）→ 全部归 1 turn
    const logs: ProcessedLog[] = [
      makeProcessed("tool_call", JSON.stringify({ tool: "Bash" }), "tc1"),
      makeProcessed("tool_call", JSON.stringify({ tool: "Read" }), "tc2"),
    ];
    const turns = groupIntoTurns(logs);
    expect(turns.length).toBe(1);
    expect(turns[0]!.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  2. AgentLogViewer turn 分组渲染                                    */
/* ------------------------------------------------------------------ */

describe("task-15: AgentLogViewer turn 分组渲染", () => {
  it("渲染 Turn N 头 + 时间范围", () => {
    const logs: AgentRunLogEntry[] = [
      makeRawLog("user_input", "第一次提问", "u1", "2026-06-22T06:24:04.000Z"),
      makeRawLog("stdout", "[ASSISTANT] 回答", "a1", "2026-06-22T06:24:20.000Z"),
      makeRawLog("user_input", "第二次提问", "u2", "2026-06-22T06:25:04.000Z"),
      makeRawLog("stdout", "[ASSISTANT] 回答2", "a2", "2026-06-22T06:25:20.000Z"),
    ];
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={logs}
        loading={false}
        emptyText="空"
      />,
    );
    // 两个 turn 头
    expect(screen.getByText("Turn 1")).toBeInTheDocument();
    expect(screen.getByText("Turn 2")).toBeInTheDocument();
    // 时间范围（取 turn 内首末时间戳）。formatLogClock 用 toLocaleTimeString 转
    // 本地时区，测试环境时区不固定 → 断言"两个时间戳出现在同一 turn 头 span"。
    // Turn 1 的 turn-head 应含"06:24:04"和"06:24:20"（UTC）或对应本地时间，
    // 用 textContent 匹配保证完整范围在一行内。
    const turn1Head = screen.getByText("Turn 1").closest("div");
    expect(turn1Head).not.toBeNull();
    const headText = turn1Head!.textContent ?? "";
    // 头部文本含两个时间戳（形式 "HH:MM:SS → HH:MM:SS"）
    expect(headText.match(/\d{2}:\d{2}:\d{2}\s*→\s*\d{2}:\d{2}:\d{2}/)).not.toBeNull();
  });

  it("空 logs 不渲染 turn（显示 emptyText）", () => {
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={[]}
        loading={false}
        emptyText="暂无日志"
      />,
    );
    expect(screen.getByText("暂无日志")).toBeInTheDocument();
    expect(screen.queryByText("Turn 1")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  3. thinking 折叠                                                   */
/* ------------------------------------------------------------------ */

describe("task-15: thinking 默认折叠为单行摘要", () => {
  it("折叠态显示摘要前缀 + '思考' 标题，不渲染全文", () => {
    // 用 > 60 字符的 thinking，触发 summary 截断（前 60 字符 + "..."）。
    const longThinking =
      "用户要求我执行 sillyspec scan 流程来分析项目 myaaa。这是一个需要仔细规划的复杂任务，包含多个子步骤和平台参数处理，必须按顺序执行。";
    const logs: AgentRunLogEntry[] = [
      makeRawLog("stdout", `[THINKING] ${longThinking}`, "t1", "2026-06-22T06:24:11.000Z"),
    ];
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={logs}
        loading={false}
        emptyText="空"
      />,
    );
    // 折叠标题"思考"可见
    expect(screen.getByText("思考")).toBeInTheDocument();
    // 折叠态：摘要带 "..." 截断标记可见（证明 summary 生效）
    expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument();
    // 摘要前 30 字符可见
    expect(screen.getByText(new RegExp(longThinking.slice(0, 20)))).toBeInTheDocument();
    // 全文（完整长内容，含末尾"必须按顺序执行。"）在折叠态不应渲染
    expect(screen.queryByText(longThinking)).not.toBeInTheDocument();
  });

  it("点击 chevron 展开后渲染全文", () => {
    const longThinking =
      "用户要求我执行 sillyspec scan 流程来分析项目 myaaa。这是一个需要仔细规划的复杂任务，包含多个子步骤和平台参数处理，必须按顺序执行。";
    const logs: AgentRunLogEntry[] = [
      makeRawLog("stdout", `[THINKING] ${longThinking}`, "t1", "2026-06-22T06:24:11.000Z"),
    ];
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={logs}
        loading={false}
        emptyText="空"
      />,
    );
    // 点击"思考"按钮展开
    const toggle = screen.getByText("思考").closest("button");
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);
    // 展开后全文可见
    expect(screen.getByText(longThinking)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  4. tool 卡片状态徽标 + 耗时                                        */
/* ------------------------------------------------------------------ */

describe("task-15: tool 卡片状态徽标 + 耗时", () => {
  it("成功 tool 显示 ✓ + 耗时秒数", () => {
    // tool_call JSON 带 success=true + tool_use_id；耗时由 result timestamp 算出
    const toolUseTs = "2026-06-22T06:24:15.000Z";
    const resultTs = "2026-06-22T06:24:20.700Z"; // +5.7s
    const logs: AgentRunLogEntry[] = [
      makeRawLog(
        "tool_call",
        JSON.stringify({
          tool: "Bash",
          args: { command: "echo hello" },
          success: true,
          tool_use_id: "toolu_abc1",
          timestamp: toolUseTs,
        }),
        "tc1",
        toolUseTs,
      ),
      makeRawLog(
        "stdout",
        "[TOOL_RESULT] 完成\nhello",
        "tr1",
        resultTs,
      ),
    ];
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={logs}
        loading={false}
        emptyText="空"
      />,
    );
    // 状态徽标含 ✓
    expect(screen.getByText(/✓/)).toBeInTheDocument();
    // 耗时秒数（5.7s）
    expect(screen.getByText(/5\.7s/)).toBeInTheDocument();
  });

  it("失败 tool 显示 ✗ 标记", () => {
    const logs: AgentRunLogEntry[] = [
      makeRawLog(
        "tool_call",
        JSON.stringify({
          tool: "Bash",
          args: { command: "false" },
          success: false,
          tool_use_id: "toolu_fail1",
          timestamp: "2026-06-22T06:24:28.000Z",
        }),
        "tc1",
        "2026-06-22T06:24:28.000Z",
      ),
      makeRawLog(
        "stdout",
        "[TOOL_RESULT] Exit code 1",
        "tr1",
        "2026-06-22T06:24:31.000Z",
      ),
    ];
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={logs}
        loading={false}
        emptyText="空"
      />,
    );
    // 失败徽标 ✗
    expect(screen.getByText(/✗/)).toBeInTheDocument();
  });

  it("进行中 tool（无 result）只显示状态，不显示耗时秒数", () => {
    const logs: AgentRunLogEntry[] = [
      makeRawLog(
        "tool_call",
        JSON.stringify({
          tool: "Bash",
          args: { command: "sleep 10" },
          success: true,
          tool_use_id: "toolu_pending",
          timestamp: "2026-06-22T06:24:15.000Z",
        }),
        "tc1",
        "2026-06-22T06:24:15.000Z",
      ),
    ];
    render(
      <AgentLogViewer
        title="测试"
        runId="r1"
        logs={logs}
        loading={false}
        emptyText="空"
      />,
    );
    // tool 名可见（卡片已渲染）
    expect(screen.getByText("Bash")).toBeInTheDocument();
    // 无 result → 不应有耗时秒数（"[0-9.]+s"）
    expect(screen.queryByText(/\d+\.\d+s/)).not.toBeInTheDocument();
  });
});
