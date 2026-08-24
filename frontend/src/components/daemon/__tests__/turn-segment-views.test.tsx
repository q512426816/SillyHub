// task-12（2026-08-19-session-stream-ux / FR-01 / FR-02 / FR-03 / FR-05 / FR-06 / D-003@v1）：
// 段渲染组件族 + 轮级状态条单测（行为规格，design §6 测试维度清单）。
//
// 覆盖维度：
//   1. 各段类型渲染——text（MarkdownText 正文 + streaming 光标 .seg-caret）/ thinking
//      （折叠头「💭 思考过程」+ 摘要 60 字截断）/ tool（工具名 + 主参数 + 状态徽章
//      ✓/⏳/✗ + result 展开 + 复制按钮）/ stderr（⚠ 前缀）/ tool 带 children → 子代理块 /
//      file（task-08 → FileMessageCard 分流 + 五字段透传，卡片本体另测）；
//   2. 折叠交互——思考行 / 工具行 / 子代理块默认折叠 → 点击展开内容可见；
//   3. 扫动动画类名——running 工具行与子代理头含 seg-sweep，ok/deny 不含；
//   4. 子代理递归——depth>1 嵌套渲染 + running→终态自动收敛折叠 + stub 名称回退；
//   5. deriveTurnActivity 纯函数——toolCount 递归计数（含 stub children）/
//      currentActivity 回退链 / subagents 清单（name 回退链 + status 推导）；
//   6. TurnStatusBar——运行态文案 + 工具计数 + 15s 计时门槛（fake timers 推进）+
//      null 锚点容错；formatElapsedMmss 边界。
//
// 测试纪律：FIRST / AAA / 每用例独立 fixture / 断言真实渲染输出 / 零 mock 被测组件；
// 仅按既有惯例 mock MarkdownText（next/dynamic ssr:false 在 jsdom 同步渲染为 null，
// 同 turn-timeline-session-input-bar.test.tsx）。视图两态（进度/对话）与装配器纯
// 函数分别已由 task-10 / task-03 的测试文件覆盖，本文件不重复（task-12 constraints）。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import {
  SegmentView,
  TextSegmentView,
  ThinkingRowView,
  ToolRowView,
  SubagentBlockView,
  StderrRowView,
  TeamWorkerBlockView,
} from "../turn-segment-views";
import type {
  TextTurnSegment,
  ThinkingTurnSegment,
  StderrTurnSegment,
  FileTurnSegment,
} from "../turn-segment-views";
import {
  TurnStatusBar,
  deriveTurnActivity,
  formatElapsedMmss,
} from "../turn-status-bar";
import type {
  StubTurnSegment,
  ToolTurnSegment,
} from "../session-log-assembler";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

// task-08：file 段卡片以桩替换——卡内两形态（图片缩略图/通用卡）与下载交互由
// file-message-card.test.tsx 专项覆盖，本文件只锁 SegmentView 的分流与字段透传。
vi.mock("@/components/daemon/file-message-card", () => ({
  FileMessageCard: (props: Record<string, unknown>) => (
    <div
      data-testid="file-message-card"
      data-file-id={String(props.fileId)}
      data-mime={String(props.mime)}
      data-name={String(props.name)}
      data-size={String(props.size)}
    />
  ),
}));

/* ───────── fixture 构造器（每用例独立，按断言场景覆盖字段） ───────── */

/** Bash 工具调用 raw（复制按钮用例：copyText 规则 → args.command）。 */
const BASH_RAW = JSON.stringify({
  tool: "Bash",
  args: { command: "npm test" },
  tool_use_id: "call_b",
  success: true,
});

function makeTextSeg(overrides: Partial<TextTurnSegment> = {}): TextTurnSegment {
  return {
    kind: "text",
    id: "text:main:m1:1",
    text: "答复正文",
    streaming: false,
    startedAt: 1_000,
    ...overrides,
  };
}

function makeThinkingSeg(
  overrides: Partial<ThinkingTurnSegment> = {},
): ThinkingTurnSegment {
  return {
    kind: "thinking",
    id: "thinking:t1",
    text: "先想想再答",
    streaming: false,
    ts: 1_000,
    ...overrides,
  };
}

function makeStderrSeg(overrides: Partial<StderrTurnSegment> = {}): StderrTurnSegment {
  return { kind: "stderr", id: "stderr:e1", text: "命令警告输出", ts: 1_000, ...overrides };
}

function makeToolSeg(overrides: Partial<ToolTurnSegment> = {}): ToolTurnSegment {
  return {
    kind: "tool",
    id: "call_1",
    raw: JSON.stringify({
      tool: "Read",
      args: { file_path: "src/a.ts" },
      tool_use_id: "call_1",
      success: true,
    }),
    result: "文件内容 A",
    status: "ok",
    toolName: "Read",
    primary: "src/a.ts",
    startedAt: 1_000,
    endedAt: 1_500,
    children: [],
    subagentType: null,
    ...overrides,
  };
}

/** 运行中 Bash 段（无 result / 无 endedAt），覆盖字段可再调整。 */
function makeBashRunningSeg(overrides: Partial<ToolTurnSegment> = {}): ToolTurnSegment {
  return makeToolSeg({
    id: "call_b",
    raw: BASH_RAW,
    result: undefined,
    status: "running",
    toolName: "Bash",
    primary: "npm test",
    startedAt: 5_000,
    endedAt: null,
    ...overrides,
  });
}

function makeStubSeg(overrides: Partial<StubTurnSegment> = {}): StubTurnSegment {
  return {
    kind: "subagent_stub",
    id: "call_stub",
    subagentType: "Explore",
    children: [],
    ...overrides,
  };
}

/** 文件段 fixture（task-08 / design §7.3，字段对齐 FileUpload content JSON 五字段）。 */
function makeFileSeg(overrides: Partial<FileTurnSegment> = {}): FileTurnSegment {
  return {
    kind: "file",
    id: "file:1",
    fileId: "f-1",
    name: "q3-bug-trend.png",
    size: 186368,
    mime: "image/png",
    description: "三季度 Bug 趋势图",
    ts: 1_000,
    ...overrides,
  };
}

/** 从行内文本节点向上定位工具行 / 子代理头的行容器（role=button 的 div）。 */
function rowOf(text: string): HTMLElement {
  const el = screen.getByText(text).closest('div[role="button"]');
  if (!el) throw new Error(`row container not found for "${text}"`);
  return el as HTMLElement;
}

/* ───────── 1. 各段类型渲染 ───────── */

describe("TextSegmentView 文本段", () => {
  it("streaming：渲染 MarkdownText 正文 + 流式光标 .seg-caret", () => {
    render(
      <TextSegmentView segment={makeTextSeg({ text: "正在流式输出的正文", streaming: true })} />,
    );
    expect(screen.getByTestId("markdown-text").textContent).toBe("正在流式输出的正文");
    expect(document.querySelector(".seg-caret")).not.toBeNull();
  });

  it("非 streaming：正文正常渲染且无光标", () => {
    render(<TextSegmentView segment={makeTextSeg()} />);
    expect(screen.getByTestId("markdown-text").textContent).toBe("答复正文");
    expect(document.querySelector(".seg-caret")).toBeNull();
  });
});

describe("ThinkingRowView 思考段", () => {
  it("默认折叠：显示「💭 思考过程」标题 + 摘要，正文未挂载（R-03 按需挂载）", () => {
    render(<ThinkingRowView segment={makeThinkingSeg()} />);
    expect(screen.getByText("💭 思考过程")).toBeInTheDocument();
    expect(screen.getByText("先想想再答")).toBeInTheDocument(); // 短文本摘要原样
    expect(screen.queryByTestId("markdown-text")).toBeNull();
  });

  it("摘要空白折叠 + 60 字截断（超长思考只显前 60 字 + 省略号）", () => {
    const longText = "甲".repeat(30) + "\n  " + "乙".repeat(40); // 折叠空白后 71 字
    render(<ThinkingRowView segment={makeThinkingSeg({ text: longText })} />);
    const expected = "甲".repeat(30) + " " + "乙".repeat(29) + "…";
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(longText)).toBeNull(); // 原始换行 / 多空格不进摘要
  });

  it("点击折叠头展开正文全文，再点击收起", () => {
    const longText = "开头一句。" + "很长的思考内容。".repeat(10); // 90 字 > 60，摘要≠全文
    render(<ThinkingRowView segment={makeThinkingSeg({ text: longText })} />);
    const header = screen.getByRole("button", { name: /思考过程/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("markdown-text").textContent).toBe(longText);
    fireEvent.click(header);
    expect(screen.queryByTestId("markdown-text")).toBeNull();
  });

  it("streaming：折叠头显示「思考中」脉冲标记", () => {
    render(<ThinkingRowView segment={makeThinkingSeg({ streaming: true })} />);
    expect(screen.getByText("思考中")).toBeInTheDocument();
  });
});

describe("ToolRowView 工具行", () => {
  it("ok：工具名 + 主参数 + ✓ 徽章 + 耗时，无扫动动画类", () => {
    render(<ToolRowView segment={makeToolSeg()} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByTitle("执行成功").textContent).toBe("✓");
    expect(screen.getByText("0.5s")).toBeInTheDocument(); // 1500-1000=500ms
    expect(rowOf("Read").className).not.toContain("seg-sweep");
  });

  it("deny：✗ 徽章，无扫动动画类", () => {
    render(<ToolRowView segment={makeToolSeg({ status: "deny", result: "操作被拒绝" })} />);
    expect(screen.getByTitle("执行失败 / 被拒").textContent).toBe("✗");
    expect(rowOf("Read").className).not.toContain("seg-sweep");
  });

  it("running：⏳ 徽章 + 行容器含 seg-sweep 扫动类；无 result 展开显示「执行中…」占位", () => {
    render(<ToolRowView segment={makeBashRunningSeg()} />);
    expect(screen.getByTitle("执行中").textContent).toBe("⏳");
    const row = rowOf("npm test");
    expect(row.className).toContain("seg-sweep");
    fireEvent.click(row);
    expect(screen.getByText("执行中…")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-text")).toBeNull();
  });

  it("点击整行展开 result（MarkdownText 渲染），再点击收起", () => {
    render(<ToolRowView segment={makeToolSeg()} />);
    const row = rowOf("Read");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("markdown-text").textContent).toBe("文件内容 A");
    fireEvent.click(row);
    expect(screen.queryByTestId("markdown-text")).toBeNull();
  });

  it("复制按钮：Bash 命令写入剪贴板，且不触发展开（stopPropagation）", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ToolRowView
        segment={makeToolSeg({ id: "call_b", raw: BASH_RAW, toolName: "Bash", primary: "npm test" })}
      />,
    );
    const row = rowOf("npm test");
    fireEvent.click(screen.getByTitle("复制命令"));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("npm test");
    expect(row).toHaveAttribute("aria-expanded", "false"); // 复制不联动展开
  });

  it("raw 解析失败（R-07 容错）：主参数位置原样显示 raw，无复制按钮", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({ raw: "人类可读的工具摘要（非 JSON）", toolName: null, primary: null })}
      />,
    );
    expect(screen.getByText("工具调用")).toBeInTheDocument(); // raw 非空 → 「工具调用」
    expect(screen.getByText(/人类可读的工具摘要/)).toBeInTheDocument();
    expect(screen.queryByTitle("复制命令")).toBeNull();
  });

  /* ql-20260824-018：Write/Edit 参数详情预览（规则搬自 agent-log/tool-renderers，
     修复段模型改版后「只能看到一句成功结果、看不到具体改动内容」）。 */

  const WRITE_RAW = JSON.stringify({
    tool: "Write",
    args: { file_path: "src/theme.ts", content: 'export const theme = {\n  primary: "cyan",\n};' },
    tool_use_id: "call_w",
    success: true,
  });
  const EDIT_RAW = JSON.stringify({
    tool: "Edit",
    args: {
      file_path: "src/theme.ts",
      old_string: 'primary: "violet"',
      new_string: 'primary: "cyan"',
    },
    tool_use_id: "call_e",
    success: true,
  });

  it("Write 展开：参数详情（内容预览 + 复制内容按钮）在上方，工具结果在下方", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_w",
          raw: WRITE_RAW,
          toolName: "Write",
          primary: "src/theme.ts",
          result: "The file src/theme.ts has been updated",
        })}
      />,
    );
    fireEvent.click(rowOf("Write"));
    expect(screen.getByText(/export const theme/)).toBeInTheDocument();
    expect(screen.getByTitle("复制内容")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-text").textContent).toBe(
      "The file src/theme.ts has been updated",
    );
    // 参数详情块在 result 之前（DOM 序：pre 在 markdown-text 前；位掩码非零即跟随其后）
    const detail = screen.getByText(/export const theme/).closest("pre");
    const resultEl = screen.getByTestId("markdown-text");
    expect(
      detail && resultEl
        ? detail.compareDocumentPosition(resultEl) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
  });

  it("Write 超长内容 5 万字符截断（沿用 ql-20260709-002 规则），复制仍带完整原文", () => {
    // CopyButton 依赖 writeText().then(...)，mock 必须返回 Promise（非 undefined）
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const long = "x".repeat(50_001);
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_w2",
          raw: JSON.stringify({
            tool: "Write",
            args: { file_path: "big.ts", content: long },
            tool_use_id: "call_w2",
            success: true,
          }),
          toolName: "Write",
          primary: "big.ts",
          result: "ok",
        })}
      />,
    );
    fireEvent.click(rowOf("Write"));
    const pre = screen.getByText(/\(截断\)/);
    expect(pre.textContent).toBe(`${"x".repeat(50_000)}\n... (截断)`);
    fireEvent.click(screen.getByTitle("复制内容"));
    expect(writeText).toHaveBeenCalledWith(long); // 复制完整原文不截断
  });

  it("Edit 展开：红 - 原文本 / 绿 + 新文本对比块，工具结果在下方", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_e",
          raw: EDIT_RAW,
          toolName: "Edit",
          primary: "src/theme.ts",
          result: "The file src/theme.ts has been updated",
        })}
      />,
    );
    fireEvent.click(rowOf("Edit"));
    expect(screen.getByText('primary: "violet"')).toBeInTheDocument();
    expect(screen.getByText('primary: "cyan"')).toBeInTheDocument();
    expect(screen.getByTestId("markdown-text").textContent).toBe(
      "The file src/theme.ts has been updated",
    );
  });

  it("Write 运行中（result 未配对）：展开仍显示内容预览 + 「执行中…」占位", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_w3",
          raw: WRITE_RAW,
          toolName: "Write",
          primary: "src/theme.ts",
          result: undefined,
          status: "running",
          endedAt: null,
        })}
      />,
    );
    fireEvent.click(rowOf("Write"));
    expect(screen.getByText(/export const theme/)).toBeInTheDocument();
    expect(screen.getByText("执行中…")).toBeInTheDocument();
  });

  /* ql-20260824-019：展开区详情继续补齐——Edit 行级 diff / Grep 参数+命中数 /
     通用参数 JSON / Bash 纯文本输出+复制 / Read 行范围+复制 / Agent Prompt。 */

  it("Edit 展开渲染行级 diff：红底 - 旧行 / 绿底 + 新行 + 双侧行号列，不再是两个裸代码块", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_e2",
          raw: JSON.stringify({
            tool: "Edit",
            args: {
              file_path: "src/theme.ts",
              old_string: 'const primary = "violet";',
              new_string: 'const primary = "cyan";',
            },
            tool_use_id: "call_e2",
            success: true,
          }),
          toolName: "Edit",
          primary: "src/theme.ts",
          result: "The file src/theme.ts has been updated",
        })}
      />,
    );
    fireEvent.click(rowOf("Edit"));
    const delRow = screen.getByText('const primary = "violet";').closest("div.flex");
    const addRow = screen.getByText('const primary = "cyan";').closest("div.flex");
    expect(delRow?.className).toContain("bg-red-500/10");
    expect(addRow?.className).toContain("bg-emerald-500/10");
    // 行号列（双侧各 1）与 -/+ 标记
    expect(delRow?.textContent).toContain("1");
    expect(delRow?.textContent).toContain("-");
    expect(addRow?.textContent).toContain("+");
    expect(screen.getByTestId("markdown-text").textContent).toContain("has been updated");
  });

  it("Edit replace_all=true：显示「全局替换」徽章", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_e3",
          raw: JSON.stringify({
            tool: "Edit",
            args: {
              file_path: "a.ts",
              old_string: "x",
              new_string: "y",
              replace_all: true,
            },
            tool_use_id: "call_e3",
            success: true,
          }),
          toolName: "Edit",
          primary: "a.ts",
        })}
      />,
    );
    fireEvent.click(rowOf("Edit"));
    expect(screen.getByText("全局替换")).toBeInTheDocument();
  });

  /* ql-20260824-020：Edit 展开优先消费 structuredPatch（backend edit_patch 列
     透传）的文件内真实行号，无 patch / 非法 patch 回退 LCS 片段相对行号。 */

  it("Edit 展开：editPatch 优先，行号为文件内真实行号（55 起，非片段相对 1）", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_e4",
          raw: EDIT_RAW,
          toolName: "Edit",
          primary: "src/theme.ts",
          result: "The file src/theme.ts has been updated",
          editPatch: JSON.stringify([
            {
              oldStart: 55,
              newStart: 55,
              oldLines: 1,
              newLines: 1,
              lines: ['-primary: "violet"', '+primary: "cyan"'],
            },
          ]),
        })}
      />,
    );
    fireEvent.click(rowOf("Edit"));
    const delRow = screen.getByText('primary: "violet"').closest("div.flex");
    const addRow = screen.getByText('primary: "cyan"').closest("div.flex");
    expect(delRow?.textContent).toContain("55"); // 旧侧真实行号
    expect(addRow?.textContent).toContain("55"); // 新侧真实行号
    expect(delRow?.className).toContain("bg-red-500/10");
    expect(addRow?.className).toContain("bg-emerald-500/10");
  });

  it("Edit 展开：editPatch 非法 JSON → 回退 LCS 片段相对行号（1 起）", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_e5",
          raw: EDIT_RAW,
          toolName: "Edit",
          primary: "src/theme.ts",
          result: "The file src/theme.ts has been updated",
          editPatch: "{malformed",
        })}
      />,
    );
    fireEvent.click(rowOf("Edit"));
    const delRow = screen.getByText('primary: "violet"').closest("div.flex");
    expect(delRow?.textContent).toContain("1");
    expect(delRow?.textContent).not.toContain("55");
  });

  it("Grep 展开：参数行（路径/glob）+ 命中 N 条 + result 在下方", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_g",
          raw: JSON.stringify({
            tool: "Grep",
            args: { pattern: "TODO", path: "src/lib", glob: "*.ts" },
            tool_use_id: "call_g",
            success: true,
          }),
          toolName: "Grep",
          primary: "TODO",
          result: "Found 3 matches",
        })}
      />,
    );
    fireEvent.click(rowOf("Grep"));
    expect(screen.getByText(/src\/lib/)).toBeInTheDocument();
    expect(screen.getByText(/\*\.ts/)).toBeInTheDocument();
    // 「命中 N 条」数字在独立 span（跨元素文本，用正则按片段匹配）
    expect(screen.getByText(/命中/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-text").textContent).toBe("Found 3 matches");
  });

  it("通用工具（MCP）展开：参数 JSON pre 可见 + 复制参数按钮", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_m",
          raw: JSON.stringify({
            tool: "mcp__srv__query",
            args: { file_id: "f-9", question: "三季度数据" },
            tool_use_id: "call_m",
            success: true,
          }),
          toolName: "mcp__srv__query",
          primary: null,
          result: "答案…",
        })}
      />,
    );
    fireEvent.click(rowOf("mcp__srv__query"));
    // 行首摘要 span（desc 回退 raw）与展开区参数 pre 都含该值——收窄到 pre 块断言
    const argPre = screen.getByTitle("复制参数").closest("div.mb-2")?.querySelector("pre");
    expect(argPre?.textContent).toContain("三季度数据");
    expect(screen.getByTitle("复制参数")).toBeInTheDocument();
  });

  it("Bash 展开：输出为纯文本 pre（不走 Markdown）+ 复制输出收完整原文", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_b2",
          raw: JSON.stringify({
            tool: "Bash",
            args: { command: "pnpm test" },
            tool_use_id: "call_b2",
            success: true,
          }),
          toolName: "Bash",
          primary: "pnpm test",
          result: "# 不是标题\nplain output *text*",
        })}
      />,
    );
    fireEvent.click(rowOf("pnpm test"));
    expect(screen.queryByTestId("markdown-text")).toBeNull();
    expect(screen.getByText(/plain output/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("复制输出"));
    expect(writeText).toHaveBeenCalledWith("# 不是标题\nplain output *text*");
  });

  it("Bash 超长输出 10 万字符前端兜底截断（复制仍带完整原文）", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const long = "y".repeat(100_001);
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_b3",
          raw: JSON.stringify({ tool: "Bash", args: { command: "cat big.log" }, tool_use_id: "call_b3", success: true }),
          toolName: "Bash",
          primary: "cat big.log",
          result: long,
        })}
      />,
    );
    fireEvent.click(rowOf("cat big.log"));
    expect(screen.getByText(/已截断/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("复制输出"));
    expect(writeText).toHaveBeenCalledWith(long);
  });

  it("Read 展开：行范围标注（offset–limit）+ 复制内容按钮复制 result", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_r",
          raw: JSON.stringify({
            tool: "Read",
            args: { file_path: "src/a.ts", offset: 10, limit: 20 },
            tool_use_id: "call_r",
            success: true,
          }),
          toolName: "Read",
          primary: "src/a.ts",
          result: "文件内容 A",
        })}
      />,
    );
    fireEvent.click(rowOf("Read"));
    expect(screen.getByText("行 10–30")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("复制内容"));
    expect(writeText).toHaveBeenCalledWith("文件内容 A");
  });

  it("Agent 展开：Prompt 预览 + 复制 Prompt（完整原文）", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_ag",
          raw: JSON.stringify({
            tool: "Agent",
            args: { description: "调研主题", prompt: "请分析主题配色方案" },
            tool_use_id: "call_ag",
            success: true,
          }),
          toolName: "Agent",
          primary: "调研主题",
          result: "调研完成",
        })}
      />,
    );
    fireEvent.click(rowOf("调研主题"));
    expect(screen.getByText(/请分析主题配色方案/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("复制 Prompt"));
    expect(writeText).toHaveBeenCalledWith("请分析主题配色方案");
  });

  it("无专属详情且无 args 的工具（raw 解析失败）：展开保持 result-only 零回归", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          raw: "人类可读的工具摘要（非 JSON）",
          toolName: null,
          primary: null,
        })}
      />,
    );
    fireEvent.click(screen.getByText("工具调用"));
    expect(screen.getByTestId("markdown-text").textContent).toBe("文件内容 A");
    expect(screen.queryByTitle("复制参数")).toBeNull();
  });
});

describe("StderrRowView 警示行", () => {
  it("⚠ 前缀 + stderr 文本", () => {
    render(<StderrRowView segment={makeStderrSeg()} />);
    expect(screen.getByText("⚠")).toBeInTheDocument();
    expect(screen.getByText("命令警告输出")).toBeInTheDocument();
  });
});

describe("SegmentView 统一分发器", () => {
  it("按 kind 分发到对应段组件（text / thinking / tool / stderr）", () => {
    const { unmount } = render(<SegmentView segment={makeTextSeg()} />);
    expect(screen.getByTestId("markdown-text")).toBeInTheDocument();
    unmount();

    render(<SegmentView segment={makeThinkingSeg()} />);
    expect(screen.getByText("💭 思考过程")).toBeInTheDocument();
    unmount();

    render(<SegmentView segment={makeToolSeg()} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.queryByText("🤖")).not.toBeInTheDocument(); // 无 children → 工具行而非子代理块
    unmount();

    render(<SegmentView segment={makeStderrSeg()} />);
    expect(screen.getByText("⚠")).toBeInTheDocument();
  });

  it("tool 段带 children → 升级子代理块渲染（ok 默认折叠不挂载 children）", () => {
    render(
      <SegmentView
        segment={makeToolSeg({
          id: "call_agent",
          toolName: "Agent",
          primary: "调研员",
          subagentType: "research",
          children: [makeTextSeg({ id: "text:child", text: "子代理内部文本" })],
        })}
      />,
    );
    expect(screen.getByText("🤖")).toBeInTheDocument();
    expect(screen.getByText("调研员")).toBeInTheDocument();
    expect(screen.getByText("research")).toBeInTheDocument(); // 类型标签
    expect(screen.queryByText("子代理内部文本")).not.toBeInTheDocument(); // 默认折叠
  });

  it("subagent_stub 兜底段复用子代理块：名称回退 subagentType，恒 running 默认展开", () => {
    render(
      <SegmentView
        segment={makeStubSeg({ children: [makeTextSeg({ id: "text:stub", text: "stub 内部文本" })] })}
      />,
    );
    // 名称与类型标签均显示 subagentType（stub 无 primary/toolName 可回退）
    expect(screen.getAllByText("Explore").length).toBe(2);
    expect(screen.getByText("stub 内部文本")).toBeInTheDocument(); // running 默认展开
  });

  it("subagent_stub 无 subagentType：名称回退「子代理」且无类型标签", () => {
    render(<SegmentView segment={makeStubSeg({ subagentType: null })} />);
    expect(screen.getByText("子代理")).toBeInTheDocument();
  });

  it("file 段 → FileMessageCard 接线：「agent 上传了文件」标注 + 五字段透传（task-08）", () => {
    render(<SegmentView segment={makeFileSeg()} />);
    expect(screen.getByText("agent 上传了文件")).toBeInTheDocument();
    const card = screen.getByTestId("file-message-card");
    expect(card.getAttribute("data-file-id")).toBe("f-1");
    expect(card.getAttribute("data-name")).toBe("q3-bug-trend.png");
    expect(card.getAttribute("data-size")).toBe("186368");
    expect(card.getAttribute("data-mime")).toBe("image/png");
  });
});

/* ───────── 2/3/4. 折叠交互 / 扫动动画 / 子代理递归 ───────── */

describe("SubagentBlockView 子代理块", () => {
  it("完成态默认折叠：头部绿点 / 名称 / 类型标签 / mm:ss 时长；点击展开 children", () => {
    const seg = makeToolSeg({
      id: "call_agent",
      toolName: "Agent",
      primary: "调研员",
      subagentType: "research",
      startedAt: 60_000,
      endedAt: 144_000, // 84s → 01:24
      children: [makeTextSeg({ id: "text:c1", text: "子代理正文产出" })],
    });
    render(<SubagentBlockView segment={seg} />);
    expect(document.querySelector(".bg-emerald-600")).not.toBeNull(); // ok 绿点
    expect(screen.getByText("调研员")).toBeInTheDocument();
    expect(screen.getByText("research")).toBeInTheDocument();
    expect(screen.getByText("01:24")).toBeInTheDocument();
    expect(screen.queryByText("子代理正文产出")).not.toBeInTheDocument(); // 折叠不挂载
    fireEvent.click(rowOf("调研员"));
    expect(screen.getByText("子代理正文产出")).toBeInTheDocument();
  });

  it("运行中默认展开：头部 seg-sweep 扫动 + 蓝色脉冲点 + 「运行中」时长，内部工具行可见", () => {
    const seg = makeToolSeg({
      id: "call_agent_r",
      toolName: "Agent",
      primary: "执行调研",
      subagentType: "research",
      status: "running",
      result: undefined,
      startedAt: 5_000,
      endedAt: null,
      children: [makeBashRunningSeg({ id: "call_inner" })],
    });
    render(<SubagentBlockView segment={seg} />);
    expect(screen.getByText("npm test")).toBeInTheDocument(); // 默认展开 → 内部工具行可见
    const header = rowOf("执行调研");
    expect(header.className).toContain("seg-sweep");
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(document.querySelector(".bg-brand-600")).not.toBeNull();
  });

  it("children 递归渲染支持 depth>1 嵌套（孙辈块嵌在子辈 body 内，非顶层平铺）", () => {
    const grandchild = makeToolSeg({
      id: "call_g",
      toolName: "Agent",
      primary: "孙辈代理",
      subagentType: "explore",
      startedAt: 2_000,
      endedAt: 3_000,
      children: [makeTextSeg({ id: "text:g", text: "孙辈文本产出" })],
    });
    const child = makeToolSeg({
      id: "call_c",
      toolName: "Agent",
      primary: "子辈代理",
      subagentType: "research",
      startedAt: 1_000,
      endedAt: 9_000,
      children: [grandchild],
    });
    const root = makeToolSeg({
      id: "call_root",
      toolName: "Agent",
      primary: "顶层代理",
      subagentType: "research",
      children: [child],
    });
    render(<SegmentView segment={root} />);
    fireEvent.click(rowOf("顶层代理")); // 展开根 → 子辈块挂载（自身折叠）
    expect(screen.getByText("子辈代理")).toBeInTheDocument();
    fireEvent.click(rowOf("子辈代理")); // 展开子辈 → 孙辈块挂载
    const grandchildHeader = rowOf("孙辈代理");
    expect(grandchildHeader).toBeInTheDocument();
    // 嵌套结构证明：孙辈头位于子辈 body 内；孙辈自身折叠不挂 body（全树恰两个 body）
    const bodies = document.querySelectorAll(".seg-subagent-body");
    expect(bodies.length).toBe(2);
    expect(bodies[1]?.contains(grandchildHeader)).toBe(true);
  });

  it("running → 终态过渡自动收敛为折叠（完成折叠默认）", () => {
    const running = makeToolSeg({
      id: "call_auto",
      toolName: "Agent",
      primary: "自动收敛",
      status: "running",
      result: undefined,
      children: [makeTextSeg({ id: "text:auto", text: "运行中的内部文本" })],
    });
    const { rerender } = render(<SubagentBlockView segment={running} />);
    expect(screen.getByText("运行中的内部文本")).toBeInTheDocument(); // 运行中默认展开
    const finished: ToolTurnSegment = { ...running, status: "ok", result: "产出", endedAt: 9_000 };
    rerender(<SubagentBlockView segment={finished} />);
    expect(screen.queryByText("运行中的内部文本")).not.toBeInTheDocument(); // 过渡即收敛折叠
  });
});

/* ───────── 5. deriveTurnActivity 纯函数（task-07 契约） ───────── */

describe("deriveTurnActivity（toolCount / subagents / currentActivity）", () => {
  it("空轮：toolCount=0 / subagents 空 / currentActivity=null", () => {
    expect(deriveTurnActivity([])).toEqual({
      toolCount: 0,
      subagents: [],
      currentActivity: null,
    });
  });

  it("toolCount 递归计数：顶层 + 容器自身 + 容器内部 + stub children（stub 本身不计）", () => {
    const inner = makeBashRunningSeg({ id: "call_in", startedAt: 9_000 });
    const container = makeToolSeg({
      id: "call_root",
      toolName: "Agent",
      primary: "容器代理",
      subagentType: "research",
      status: "running",
      result: undefined,
      startedAt: 5_000,
      endedAt: null,
      children: [inner],
    });
    const stub = makeStubSeg({ children: [makeToolSeg({ id: "call_stub_t" })] });
    const summary = deriveTurnActivity([
      makeToolSeg({ id: "call_top" }),
      container,
      stub,
      makeTextSeg(),
    ]);
    expect(summary.toolCount).toBe(4); // call_top + call_root + call_in + call_stub_t
  });

  it("currentActivity 取 ts 最新的 running 工具段（嵌套内部工具与顶层竞争）", () => {
    const inner = makeBashRunningSeg({ id: "call_in", startedAt: 9_000 });
    const container = makeToolSeg({
      id: "call_c",
      toolName: "Agent",
      primary: "已完成的容器",
      startedAt: 5_000,
      endedAt: 8_000,
      children: [inner],
    });
    const topRunning = makeToolSeg({
      id: "call_top_r",
      raw: JSON.stringify({ tool: "Bash", args: { command: "ls -la" }, tool_use_id: "call_top_r" }),
      status: "running",
      toolName: "Bash",
      primary: "ls -la",
      result: undefined,
      startedAt: 7_000,
      endedAt: null,
    });
    // 9s 的嵌套 running 胜过 7s 的顶层 running（不是 "Bash ls -la"）
    expect(deriveTurnActivity([topRunning, container]).currentActivity).toBe("Bash npm test");
  });

  it("currentActivity 命中 running 子代理容器 → 「子代理『名』+ 内部活动」前缀；内部无活动回退「执行中」", () => {
    const withInner = makeToolSeg({
      id: "call_sa1",
      toolName: "Agent",
      primary: "调研员",
      subagentType: "research",
      status: "running",
      result: undefined,
      startedAt: 9_000, // 容器自身 ts 晚于内部工具 → 容器为最新 running 段
      endedAt: null,
      children: [makeBashRunningSeg({ id: "call_sa1_b", startedAt: 8_500 })],
    });
    expect(deriveTurnActivity([withInner]).currentActivity).toBe("子代理「调研员」Bash npm test");

    const idle = makeToolSeg({
      id: "call_sa2",
      toolName: "Agent",
      primary: "空转代理",
      status: "running",
      result: undefined,
      startedAt: 9_000,
      endedAt: null,
      children: [makeTextSeg({ id: "text:idle", streaming: false })],
    });
    expect(deriveTurnActivity([idle]).currentActivity).toBe("子代理「空转代理」执行中");
  });

  it("无 running 工具段回退 streaming 段：text → 「正在输出文本」/ thinking → 「正在思考」", () => {
    expect(deriveTurnActivity([makeTextSeg({ streaming: true })]).currentActivity).toBe(
      "正在输出文本",
    );
    expect(deriveTurnActivity([makeThinkingSeg({ streaming: true })]).currentActivity).toBe(
      "正在思考",
    );
  });

  it("非空轮无 running 无 streaming → 终级回退「思考中」", () => {
    expect(deriveTurnActivity([makeToolSeg(), makeTextSeg()]).currentActivity).toBe("思考中");
  });

  it("subagents 清单：DFS 收集（含嵌套）+ name 回退链 + status 推导 + 锚点透传", () => {
    const nested = makeToolSeg({
      id: "sa_nested",
      toolName: "Agent",
      primary: "嵌套代理",
      subagentType: "research",
      children: [makeTextSeg({ id: "text:nest" })],
    });
    const done = makeToolSeg({
      id: "sa_done",
      toolName: "Agent",
      primary: "调研员",
      subagentType: "research",
      startedAt: 1_000,
      endedAt: 5_000,
      children: [makeTextSeg({ id: "text:d" }), nested],
    });
    const denied = makeToolSeg({
      id: "sa_deny",
      toolName: "Explore",
      primary: null,
      subagentType: "explore",
      status: "deny",
      result: "权限被拒",
      children: [makeTextSeg({ id: "text:y" })],
    });
    const noResult = makeToolSeg({
      id: "sa_run",
      toolName: null,
      primary: null,
      subagentType: "general-purpose",
      status: "ok", // status ok 但 result 未配对 → 仍判 running
      result: undefined,
      children: [makeTextSeg({ id: "text:r" })],
    });
    const noName = makeToolSeg({
      id: "sa_noname",
      toolName: null,
      primary: null,
      subagentType: null,
      children: [makeTextSeg({ id: "text:n" })],
    });
    const { subagents } = deriveTurnActivity([done, denied, noResult, noName, makeStubSeg()]);
    expect(subagents.map((s) => [s.segmentId, s.name, s.status])).toEqual([
      ["sa_done", "调研员", "done"], // primary 优先 + result 已配对 ok → done
      ["sa_nested", "嵌套代理", "done"], // DFS：容器先出，随后其内部嵌套容器
      ["sa_deny", "Explore", "deny"], // primary 缺 → toolName 回退；deny + result → deny
      ["sa_run", "general-purpose", "running"], // toolName 缺 → subagentType 回退；result 未配对 → running
      ["sa_noname", "子代理", "done"], // 全缺 → 「子代理」；默认 result 已配对 → done
      ["call_stub", "Explore", "running"], // stub 恒 running，name=subagentType
    ]);
    const first = subagents[0];
    expect(first?.startedAt).toBe(1_000); // 计时锚点透传（task-08 目录消费）
    expect(first?.endedAt).toBe(5_000);
    expect(first?.latestActivity).toBeNull(); // 内部无 running / streaming 段
  });
});

/* ───────── 6. TurnStatusBar / formatElapsedMmss ───────── */

describe("TurnStatusBar 轮级状态条", () => {
  it("running：「执行中」+ 工具计数 + 当前活动摘要 + ≥15s 显示 mm:ss", () => {
    render(
      <TurnStatusBar
        turnStartedAt={Date.now() - 20_000}
        segments={[makeBashRunningSeg(), makeToolSeg({ id: "call_ok2" })]}
        turnStatus="running"
      />,
    );
    expect(screen.getByText("执行中")).toBeInTheDocument();
    // 计数是嵌套 span（工具 <b>2</b>），getByText 只匹配直接文本节点——从容器断言
    const bar = screen.getByText("执行中").parentElement;
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toMatch(/工具\s*2/);
    expect(screen.getByTitle("Bash npm test")).toBeInTheDocument(); // 当前活动摘要
    expect(screen.getByText("00:20")).toBeInTheDocument(); // 20s ≥ 15s 门槛
  });

  it("排队中 / 打断中标签 + 运行中子代理计数", () => {
    const mk = (id: string, running: boolean) =>
      makeToolSeg({
        id,
        toolName: "Agent",
        primary: `代理-${id}`,
        subagentType: "research",
        status: running ? "running" : "ok",
        result: running ? undefined : "产出",
        endedAt: running ? null : 9_000,
        children: [makeTextSeg({ id: `text:${id}` })],
      });
    const segs = [mk("sa_a", true), mk("sa_b", false), mk("sa_c", true)];
    const { unmount } = render(
      <TurnStatusBar turnStartedAt={null} segments={segs} turnStatus="pending" />,
    );
    expect(screen.getByText("排队中")).toBeInTheDocument();
    unmount();
    render(
      <TurnStatusBar turnStartedAt={null} segments={segs} turnStatus="interrupting" />,
    );
    expect(screen.getByText("打断中")).toBeInTheDocument();
    const bar = screen.getByText("打断中").parentElement;
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toMatch(/子代理\s*2\s*运行中/);
  });

  it("turnStartedAt=null：不渲染计时（推进 60s 仍无 mm:ss）", () => {
    vi.useFakeTimers();
    try {
      render(
        <TurnStatusBar turnStartedAt={null} segments={[makeBashRunningSeg()]} turnStatus="running" />,
      );
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText("执行中")).toBeInTheDocument();
      expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("计时门槛 15s：不足隐藏，恰好达门槛显示 mm:ss（fake timers 推进）", () => {
    vi.useFakeTimers();
    try {
      const start = Date.now(); // fake 时钟，与组件首次渲染同刻
      render(
        <TurnStatusBar
          turnStartedAt={start - 5_000}
          segments={[makeBashRunningSeg()]}
          turnStatus="running"
        />,
      );
      expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull(); // 5s：只显文案
      act(() => {
        vi.advanceTimersByTime(9_000);
      });
      expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull(); // 14s：仍低于门槛
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText("00:15")).toBeInTheDocument(); // 恰好 15s 达门槛
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("formatElapsedMmss 计时格式化", () => {
  it("边界：0 / 59_999 / 60_000 / 跨小时分钟累加 / 负数钳零", () => {
    expect(formatElapsedMmss(0)).toBe("00:00");
    expect(formatElapsedMmss(59_999)).toBe("00:59"); // 毫秒截断，不进位
    expect(formatElapsedMmss(60_000)).toBe("01:00");
    expect(formatElapsedMmss(3_723_500)).toBe("62:03"); // 跨小时分钟不封顶
    expect(formatElapsedMmss(-500)).toBe("00:00"); // 负时长钳零
  });
});

/* ───────── 7. 团队 MCP 工具卡 + 分身段块（task-12 / 2026-08-22-team-session-unify / FR-07） ───────── */

/** dispatch_worker 工具调用 raw（Claude 上报形态：mcp__<server>__<tool> 前缀）。 */
const MCP_DISPATCH_RAW = JSON.stringify({
  tool: "mcp__sillyhub__dispatch_worker",
  args: { role: "impl", objective: "修登录页按钮溢出", target_workspace_id: "11111111-2222" },
  tool_use_id: "call_dw",
  success: true,
});

function makeDispatchSeg(overrides: Partial<ToolTurnSegment> = {}): ToolTurnSegment {
  return makeToolSeg({
    id: "call_dw",
    raw: MCP_DISPATCH_RAW,
    result: undefined,
    status: "running",
    toolName: "mcp__sillyhub__dispatch_worker",
    primary: null,
    startedAt: 5_000,
    endedAt: null,
    children: [],
    ...overrides,
  });
}

describe("ToolRowView 团队 MCP 工具卡（泛化微调）", () => {
  it("mcp 前缀工具名：显示短名 + mcp 标识 + 👥 图标 + 角色/目标主参数摘要", () => {
    render(<ToolRowView segment={makeDispatchSeg({ status: "ok", endedAt: 6_000 })} />);
    expect(screen.getByText("dispatch_worker")).toBeInTheDocument(); // 短名（剥 mcp__server__ 前缀）
    expect(screen.getByText("mcp")).toBeInTheDocument(); // mcp 来源标识
    expect(screen.getByText("👥")).toBeInTheDocument(); // 团队工具统一图标
    expect(screen.getByText("impl · 修登录页按钮溢出")).toBeInTheDocument(); // 主参数摘要
  });

  it("裸工具名（无 mcp__ 前缀）同样识别：converge_mission", () => {
    render(
      <ToolRowView
        segment={makeToolSeg({
          id: "call_cv",
          raw: JSON.stringify({ tool: "converge_mission", args: {}, tool_use_id: "call_cv" }),
          toolName: "converge_mission",
          primary: null,
        })}
      />,
    );
    expect(screen.getByText("converge_mission")).toBeInTheDocument();
    expect(screen.getByText("mcp")).toBeInTheDocument();
    expect(screen.getByText("收敛分身产出")).toBeInTheDocument();
  });

  it("非团队工具不受影响：无 mcp 标识、无 👥 图标", () => {
    render(<ToolRowView segment={makeToolSeg()} />);
    expect(screen.queryByText("mcp")).not.toBeInTheDocument();
    expect(screen.queryByText("👥")).not.toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("raw 解析失败回退既有 desc 链（primary / raw 原样），不渲染团队摘要", () => {
    render(
      <ToolRowView
        segment={makeDispatchSeg({ raw: "非 JSON 摘要", toolName: "mcp__sillyhub__dispatch_worker" })}
      />,
    );
    expect(screen.getByText("dispatch_worker")).toBeInTheDocument();
    expect(screen.getByText(/非 JSON 摘要/)).toBeInTheDocument();
  });
});

describe("TeamWorkerBlockView 分身段块（violet）", () => {
  it("运行中默认展开：分身「角色」+ 状态 + mm:ss 耗时 + 工作区徽标 + children 渲染", () => {
    render(
      <TeamWorkerBlockView
        role="impl"
        status="running"
        objective="修登录页按钮溢出"
        durationMs={84_000}
        workspaceName="前端官网"
        workspaceType="frontend-code"
      >
        <div>分身内部日志</div>
      </TeamWorkerBlockView>,
    );
    expect(screen.getByText("分身「impl」")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("01:24")).toBeInTheDocument();
    expect(screen.getByText("前端官网")).toBeInTheDocument(); // 工作区徽标（类型配色）
    expect(screen.getByText("目标：修登录页按钮溢出")).toBeInTheDocument();
    expect(screen.getByText("分身内部日志")).toBeInTheDocument(); // 默认展开
  });

  it("终态默认折叠：children 不挂载；点击展开可见，再点击收起", () => {
    render(
      <TeamWorkerBlockView role="test" status="completed" durationMs={141_000}>
        <div>分身产出内容</div>
      </TeamWorkerBlockView>,
    );
    expect(screen.getByText("分身「test」")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("02:21")).toBeInTheDocument();
    expect(screen.queryByText("分身产出内容")).not.toBeInTheDocument();

    fireEvent.click(rowOf("分身「test」"));
    expect(screen.getByText("分身产出内容")).toBeInTheDocument();
    fireEvent.click(rowOf("分身「test」"));
    expect(screen.queryByText("分身产出内容")).not.toBeInTheDocument();
  });

  it("SegmentView 分发：dispatch_worker tool 段升级为分身段块（无 children 时）", () => {
    render(<SegmentView segment={makeDispatchSeg()} />);
    expect(screen.getByText("分身「impl」")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("#11111111")).toBeInTheDocument(); // target_workspace_id 短标识徽标
    expect(screen.getByText("目标：修登录页按钮溢出")).toBeInTheDocument();
    // 无 children → 预留说明，不是空白
    expect(screen.getByText(/日志与产物入口/)).toBeInTheDocument();
  });

  it("dispatch_worker 段 children（分身归属日志）渲染进段块 body", () => {
    render(
      <SegmentView
        segment={makeDispatchSeg({
          children: [makeTextSeg({ id: "text:w1", text: "分身流式日志" })],
        })}
      />,
    );
    expect(screen.getByText("分身流式日志")).toBeInTheDocument(); // running 默认展开
  });

  it("running → 终态过渡自动收敛折叠（对齐 SubagentBlockView 语义）", () => {
    const running = makeDispatchSeg();
    const { rerender } = render(<SegmentView segment={running} />);
    expect(screen.getByText("目标：修登录页按钮溢出")).toBeInTheDocument();

    const finished = makeDispatchSeg({ status: "ok", result: "{}", endedAt: 9_000 });
    rerender(<SegmentView segment={finished} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.queryByText("目标：修登录页按钮溢出")).not.toBeInTheDocument();
  });

  it("其它团队工具（get_worker_result）走普通工具卡，不升级分身段块", () => {
    render(
      <SegmentView
        segment={makeToolSeg({
          id: "call_gr",
          raw: JSON.stringify({
            tool: "mcp__sillyhub__get_worker_result",
            args: { role: "test" },
            tool_use_id: "call_gr",
          }),
          toolName: "mcp__sillyhub__get_worker_result",
          primary: null,
        })}
      />,
    );
    expect(screen.getByText("get_worker_result")).toBeInTheDocument();
    expect(screen.queryByText(/分身「/)).not.toBeInTheDocument();
  });
});
