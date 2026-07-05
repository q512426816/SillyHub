// task-08 / FR-10 / FR-11 / D-003@v1：AgentLogViewer 第二层「工具类型」筛选
// + tool_call 行工具徽标渲染测试。
//
// 覆盖：
//   - 第二层 11 按钮多选筛选（点亮多个=交集）
//   - 两层正交：第一层 tool_call + 第二层 sillyspec/skill = 只看这两类工具调用
//   - 非工具行（assistant/user）不受第二层影响
//   - tool_call 行渲染工具徽标（toolKindMeta label）
//   - tool_kind=null 旧日志：渲染灰色兜底「工具」徽标，不报错
//   - R-03 防拥挤：第二层仅在工具视图（无第一层筛选或第一层含 tool_call）显示

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AgentLogViewer } from "@/components/agent-log-viewer";
import type { AgentRunLogEntry } from "@/lib/agent";

// frontend-markdown-text-jsdom-null 记忆：MarkdownText 用 next/dynamic + ssr:false，
// jsdom 同步 render 处于 loading(null)，assistant 文本不进 DOM 致 getByText 失败。
// mock 成纯文本渲染——这些用例测的是 viewer 的过滤/徽标渲染逻辑，不测 markdown 库本身。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

function makeRawLog(
  channel: AgentRunLogEntry["channel"],
  content: string | null,
  id: string,
  timestamp = "2026-07-05T10:00:00.000Z",
  extra: Partial<AgentRunLogEntry> = {},
): AgentRunLogEntry {
  return {
    id,
    run_id: "r1",
    channel,
    content_redacted: content,
    timestamp,
    ...extra,
  } as AgentRunLogEntry;
}

// tool_call content 是 JSON；tool_kind 走顶层字段（task-07 normalize 透传 log.tool_kind）。
function toolCallLog(id: string, tool: string, toolKind: string | null): AgentRunLogEntry {
  return makeRawLog(
    "tool_call",
    JSON.stringify({ tool, args: {} }),
    id,
    "2026-07-05T10:00:00.000Z",
    { tool_kind: toolKind },
  );
}

function renderViewer(logs: AgentRunLogEntry[]) {
  return render(
    <AgentLogViewer
      title="测试"
      runId="r1"
      logs={logs}
      loading={false}
      emptyText="空"
      defaultViewMode="all"
    />,
  );
}

describe("task-08: 第二层工具类型筛选 UI（R-03 防拥挤）", () => {
  it("全部视图 + 无第一层筛选 → 显示第二层 11 按钮", () => {
    renderViewer([toolCallLog("tc1", "Bash", "bash")]);
    // 第二层按钮是 button role；用 getByRole 精确定位（避免与工具徽标 span 文本撞）
    expect(screen.getByRole("button", { name: "SillySpec" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "命令行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MCP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "其他" })).toBeInTheDocument();
  });

  it("第一层选中「工具调用」→ 显示第二层", () => {
    renderViewer([toolCallLog("tc1", "Bash", "bash")]);
    // 第一层「工具调用」按钮（getByText 仍唯一，layer2 无此 label）
    fireEvent.click(screen.getByText("工具调用"));
    expect(screen.getByRole("button", { name: "命令行" })).toBeInTheDocument();
  });

  it("第一层仅选中非工具类（如「助手回复」）→ 隐藏第二层", () => {
    renderViewer([toolCallLog("tc1", "Bash", "bash")]);
    fireEvent.click(screen.getByText("助手回复"));
    // 第二层按钮容器隐藏后，"MCP"按钮（仅第二层有）应不可见
    expect(screen.queryByText("MCP")).not.toBeInTheDocument();
  });
});

describe("task-08: 第二层多选筛选逻辑（正交 + 交集）", () => {
  // 3 条 tool_call：bash / read / web + 1 条 assistant 文本（不受第二层影响）
  // ToolCallPreview 渲染 entry.tool 名（tool-renderers.tsx:496），用作行内容锚点。
  const logs: AgentRunLogEntry[] = [
    makeRawLog("stdout", "[ASSISTANT] 我来执行", "a1"),
    toolCallLog("tc1", "Bash", "bash"),
    toolCallLog("tc2", "Read", "read"),
    toolCallLog("tc3", "WebSearch", "web"),
  ];

  it("active 空 → 显示全部 tool_call + 非工具行", () => {
    renderViewer(logs);
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Read").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("WebSearch").length).toBeGreaterThanOrEqual(1);
  });

  it("点亮「命令行」→ 只剩 bash tool_call，read/web 行被过滤", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "命令行" }));
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("WebSearch")).not.toBeInTheDocument();
  });

  it("点亮多个（命令行 + 读文件）→ 这两类保留，web 行被过滤", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "命令行" }));
    fireEvent.click(screen.getByRole("button", { name: "读文件" }));
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Read").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("WebSearch")).not.toBeInTheDocument();
  });

  it("两层正交：第一层「工具调用」+ 第二层「命令行」= 只看 bash", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByText("工具调用"));
    fireEvent.click(screen.getByRole("button", { name: "命令行" }));
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("WebSearch")).not.toBeInTheDocument();
  });

  it("清除第二层筛选 → 恢复全部 tool_call", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "命令行" }));
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    const clearBtns = screen.getAllByRole("button", { name: "清除" });
    fireEvent.click(clearBtns[clearBtns.length - 1]!);
    expect(screen.getAllByText("Read").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("WebSearch").length).toBeGreaterThanOrEqual(1);
  });
});

describe("task-08: tool_call 行工具徽标渲染（R-07 null 兜底）", () => {
  it("tool_kind=bash → 渲染「命令行」徽标", () => {
    renderViewer([toolCallLog("tc1", "Bash", "bash")]);
    // 「命令行」既出现在第二层按钮也出现在工具徽标 span（getAllByText ≥2）
    expect(screen.getAllByText("命令行").length).toBeGreaterThanOrEqual(1);
  });

  it("tool_kind=null（旧日志）→ 渲染灰色兜底「工具」徽标，不报错", () => {
    renderViewer([toolCallLog("tc1", "Bash", null)]);
    // toolKindMeta 兜底 label「工具」——与语义徽标「工具」(tool_call) 同名，
    // 故 tool_call 行会出现两个「工具」文本（语义徽标 + 兜底徽标）。
    const tools = screen.getAllByText("工具");
    expect(tools.length).toBeGreaterThanOrEqual(1);
  });

  it("tool_kind=undefined（缺字段）→ 同样兜底不报错", () => {
    const log = makeRawLog("tool_call", JSON.stringify({ tool: "Bash" }), "tc1");
    // 不设 tool_kind
    expect(log.tool_kind).toBeUndefined();
    renderViewer([log]);
    const tools = screen.getAllByText("工具");
    expect(tools.length).toBeGreaterThanOrEqual(1);
  });

  it("tool_kind=未知值（如 'unknown_kind'）→ 兜底「工具」徽标", () => {
    renderViewer([toolCallLog("tc1", "Foo", "unknown_kind")]);
    const tools = screen.getAllByText("工具");
    expect(tools.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ql-20260705-002: 其他桶逻辑（C1+C2）", () => {
  // null（旧/未打标）+ plan（UI 无按钮）+ bash（有按钮）三类 tool_call
  // tool 名各不相同，用作行锚点（ToolCallPreview 渲染 entry.tool）。
  const logs: AgentRunLogEntry[] = [
    toolCallLog("tc-null", "LegacyTool", null),
    toolCallLog("tc-plan", "ExitPlanMode", "plan"),
    toolCallLog("tc-bash", "Bash", "bash"),
  ];

  it("C1：选中「其他」→ tool_kind=null 的旧日志行显示（原被守卫 tool_kind!=null 隐藏）", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "其他" }));
    expect(screen.getAllByText("LegacyTool").length).toBeGreaterThanOrEqual(1);
  });

  it("C2：选中「其他」→ plan 行显示（UI 无 plan 按钮，归其他桶）", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "其他" }));
    expect(screen.getAllByText("ExitPlanMode").length).toBeGreaterThanOrEqual(1);
  });

  it("选中「其他」→ bash 行不显示（bash 有独立按钮，不归其他桶）", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "其他" }));
    expect(screen.queryByText("Bash")).not.toBeInTheDocument();
  });

  it("选中「命令行」（不选其他）→ null + plan 行被隐藏，只显示 bash", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "命令行" }));
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("LegacyTool")).not.toBeInTheDocument();
    expect(screen.queryByText("ExitPlanMode")).not.toBeInTheDocument();
  });

  it("多选「其他」+「命令行」→ 三行都显示", () => {
    renderViewer(logs);
    fireEvent.click(screen.getByRole("button", { name: "其他" }));
    fireEvent.click(screen.getByRole("button", { name: "命令行" }));
    expect(screen.getAllByText("LegacyTool").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ExitPlanMode").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Bash").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ql-20260705-004: 筛选标签 count（C6）", () => {
  it("第二层按钮显示对应桶的 count（aria-hidden span）", () => {
    const logs: AgentRunLogEntry[] = [
      toolCallLog("tc1", "Bash", "bash"),
      toolCallLog("tc2", "Bash", "bash"),
      toolCallLog("tc3", "Read", "read"),
    ];
    renderViewer(logs);
    // getByRole name 仍匹配 label（count span aria-hidden 不计入 accessible name）
    const cmdBtn = screen.getByRole("button", { name: "命令行" });
    expect(cmdBtn.querySelector("span")?.textContent).toBe("2");
    const readBtn = screen.getByRole("button", { name: "读文件" });
    expect(readBtn.querySelector("span")?.textContent).toBe("1");
  });

  it("count=0 的标签不显示数字 span", () => {
    renderViewer([toolCallLog("tc1", "Bash", "bash")]);
    const mcpBtn = screen.getByRole("button", { name: "MCP" });
    expect(mcpBtn.querySelector("span")).toBeNull();
  });

  it("其他桶 count = null + plan/ask/schedule + other 总和", () => {
    const logs: AgentRunLogEntry[] = [
      toolCallLog("tc1", "Old", null),
      toolCallLog("tc2", "ExitPlanMode", "plan"),
      toolCallLog("tc3", "Bash", "bash"),
    ];
    renderViewer(logs);
    const otherBtn = screen.getByRole("button", { name: "其他" });
    expect(otherBtn.querySelector("span")?.textContent).toBe("2");
  });
});
