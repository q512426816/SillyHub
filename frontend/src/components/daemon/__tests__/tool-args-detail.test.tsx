/**
 * ql-20260824-019：工具展开区详情组件族单测。
 *
 * computeLineDiff（纯函数，行为规格）：修改/新增/删除/全同/超大回退 + 双侧行号语义。
 * parseStructuredPatch（ql-20260824-020）：SDK structuredPatch hunks → DiffRow[]
 * 真实文件行号（oldStart/newStart 起计、'\' 标记行跳过、多 hunk 分隔、非法回退 null）。
 * ToolExpandBody（经 ToolRowView 的接线断言在 turn-segment-views.test.tsx，本文件
 * 只测 diff 视图的红/绿行底与行号列渲染）。
 *
 * 2026-09-27-session-fast-replay task-04 / FR-07：ToolExpandBody slim 截断全文
 * 按需回填——Provider 上下文驱动（无宿主零请求）、截断 result / raw 回填替换
 * 渲染、失败降级提示。getAgentSessionLogFull 走子模块直引（组件同路径），
 * mock "@/lib/daemon/sessions" 即拦截。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

import {
  computeLineDiff,
  DiffView,
  parseStructuredPatch,
  SlimLogFullProvider,
  ToolExpandBody,
} from "../tool-args-detail";
import type { ToolTurnSegment } from "@/components/daemon/session-log-assembler";

// MarkdownText 用 next/dynamic ssr:false，jsdom 同步 render 得 null——mock 成
// 纯文本（同 session-panel 系测试惯例）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const fullLogApi = vi.hoisted(() => ({ getAgentSessionLogFull: vi.fn() }));
vi.mock("@/lib/daemon/sessions", () => ({
  getAgentSessionLogFull: fullLogApi.getAgentSessionLogFull,
}));

beforeEach(() => {
  fullLogApi.getAgentSessionLogFull.mockReset();
});

describe("computeLineDiff（Edit 行级 diff，LCS）", () => {
  it("修改一行：ctx / del / add / ctx 序列，双侧行号各自推进", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nX\nc");
    expect(rows).toEqual([
      { type: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { type: "del", oldNo: 2, newNo: null, text: "b" },
      { type: "add", oldNo: null, newNo: 2, text: "X" },
      { type: "ctx", oldNo: 3, newNo: 3, text: "c" },
    ]);
  });

  it("纯新增：追加行为 add，仅新侧行号", () => {
    const rows = computeLineDiff("a", "a\nb");
    expect(rows).toEqual([
      { type: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { type: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });

  it("纯删除：被删行为 del，仅旧侧行号", () => {
    const rows = computeLineDiff("a\nb", "a");
    expect(rows).toEqual([
      { type: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { type: "del", oldNo: 2, newNo: null, text: "b" },
    ]);
  });

  it("完全相同：全 ctx，双侧行号同步", () => {
    const rows = computeLineDiff("x\ny", "x\ny");
    if (!rows) throw new Error("computeLineDiff should not return null for 2x2 input");
    expect(rows.every((r) => r.type === "ctx")).toBe(true);
    expect(rows.map((r) => [r.oldNo, r.newNo])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("超大输入（>100 万 LCS 单元格）返回 null，调用方回退两块展示", () => {
    const big = Array.from({ length: 1001 }, (_, i) => `line-${i}`).join("\n");
    expect(computeLineDiff(big, big + "\nextra")).toBeNull();
  });
});

describe("DiffView 渲染", () => {
  it("del 行红底 / add 行绿底 + 双侧行号列 + -/+ 标记", () => {
    const rows = computeLineDiff("a\nb", "a\nB");
    if (!rows) throw new Error("computeLineDiff should not return null for 2x2 input");
    render(<DiffView rows={rows} />);
    const delRow = screen.getByText("b").closest("div.flex");
    const addRow = screen.getByText("B").closest("div.flex");
    expect(delRow?.className).toContain("bg-red-500/10");
    expect(addRow?.className).toContain("bg-emerald-500/10");
    // 行号列：del 行旧侧 2、新侧空；add 行新侧 2、旧侧空
    expect(delRow?.textContent).toContain("2");
    expect(delRow?.textContent).toContain("-");
    expect(addRow?.textContent).toContain("+");
  });
});

describe("parseStructuredPatch（ql-20260824-020：SDK structuredPatch → 真实文件行号）", () => {
  it("单 hunk：oldStart/newStart 起计，ctx 双侧推进、del 仅旧侧、add 仅新侧", () => {
    const patch = JSON.stringify([
      {
        oldStart: 55,
        newStart: 55,
        oldLines: 3,
        newLines: 4,
        lines: [" ctx-a", "-del-b", "+add-B", "+add-B2", " ctx-c"],
      },
    ]);
    expect(parseStructuredPatch(patch)).toEqual([
      { type: "ctx", oldNo: 55, newNo: 55, text: "ctx-a" },
      { type: "del", oldNo: 56, newNo: null, text: "del-b" },
      { type: "add", oldNo: null, newNo: 56, text: "add-B" },
      { type: "add", oldNo: null, newNo: 57, text: "add-B2" },
      { type: "ctx", oldNo: 57, newNo: 58, text: "ctx-c" },
    ]);
  });

  it("多 hunk：各自 oldStart/newStart 起计，hunk 间插双侧空行号「…」分隔行", () => {
    const patch = JSON.stringify([
      { oldStart: 10, newStart: 10, oldLines: 2, newLines: 2, lines: [" a", "-b", "+B"] },
      { oldStart: 80, newStart: 80, oldLines: 1, newLines: 1, lines: ["-x", "+X"] },
    ]);
    expect(parseStructuredPatch(patch)).toEqual([
      { type: "ctx", oldNo: 10, newNo: 10, text: "a" },
      { type: "del", oldNo: 11, newNo: null, text: "b" },
      { type: "add", oldNo: null, newNo: 11, text: "B" },
      { type: "ctx", oldNo: null, newNo: null, text: "…" },
      { type: "del", oldNo: 80, newNo: null, text: "x" },
      { type: "add", oldNo: null, newNo: 80, text: "X" },
    ]);
  });

  it("'\\' 标记行（No newline at end of file）不占行号跳过", () => {
    const patch = JSON.stringify([
      {
        oldStart: 3,
        newStart: 3,
        oldLines: 2,
        newLines: 2,
        lines: ["-a", "\\ No newline at end of file", "+A", " b"],
      },
    ]);
    expect(parseStructuredPatch(patch)).toEqual([
      { type: "del", oldNo: 3, newNo: null, text: "a" },
      { type: "add", oldNo: null, newNo: 3, text: "A" },
      { type: "ctx", oldNo: 4, newNo: 4, text: "b" },
    ]);
  });

  it("非法 JSON / 形状不符（缺 oldStart、lines 非数组、空前缀行、空数组、未知前缀）→ null", () => {
    expect(parseStructuredPatch("not json")).toBeNull();
    expect(parseStructuredPatch("{}")).toBeNull();
    expect(parseStructuredPatch("[]")).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ newStart: 1, lines: [" a"] }])),
    ).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ oldStart: 1, newStart: 1, lines: "x" }])),
    ).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ oldStart: 1, newStart: 1, lines: [""] }])),
    ).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["?bad"] }])),
    ).toBeNull();
  });
});

// ── FR-07（2026-09-27-session-fast-replay）：slim 截断全文按需回填 ─────────

/** Bash 工具段固件（raw 可解析 args；result 按 case 装配）。 */
function bashSegment(overrides: Partial<ToolTurnSegment> = {}): ToolTurnSegment {
  return {
    kind: "tool",
    id: "tu-1",
    raw: JSON.stringify({ tool_use_id: "tu-1", args: { command: "pnpm test" } }),
    status: "ok",
    toolName: "Bash",
    primary: "pnpm test",
    startedAt: Date.now(),
    endedAt: Date.now(),
    children: [],
    subagentType: null,
    ...overrides,
  };
}

describe("ToolExpandBody slim 全文回填（FR-07）", () => {
  it("非截断条目零额外请求（无 contentTruncated 标记 → getAgentSessionLogFull 不触达）", async () => {
    render(
      <SlimLogFullProvider sessionId="s1">
        <ToolExpandBody
          segment={bashSegment({ result: "正常输出（未截断）" })}
          running={false}
        />
      </SlimLogFullProvider>,
    );
    expect(screen.getByText("pnpm test")).toBeTruthy();
    expect(screen.getByText("正常输出（未截断）")).toBeTruthy();
    expect(fullLogApi.getAgentSessionLogFull).not.toHaveBeenCalled();
    cleanup();
  });

  it("无宿主上下文（Provider 缺省 null）：截断条目也不请求，按截断内容渲染（零回归）", async () => {
    render(
      <ToolExpandBody
        segment={bashSegment({
          result: "截断的输出",
          resultSourceLogId: "log-r",
          resultTruncated: true,
        })}
        running={false}
      />,
    );
    expect(screen.getByText("截断的输出")).toBeTruthy();
    expect(fullLogApi.getAgentSessionLogFull).not.toHaveBeenCalled();
    cleanup();
  });

  it("截断 result 展开回填：loading 内联提示 → 拉全文（getAgentSessionLogFull(sessionId, log_id)）替换渲染", async () => {
    let release!: (v: {
      id: string;
      run_id: string;
      timestamp: string;
      channel: string;
      content_redacted: string;
    }) => void;
    const page = new Promise((r) => {
      release = r as typeof release;
    });
    fullLogApi.getAgentSessionLogFull.mockReturnValueOnce(page);
    render(
      <SlimLogFullProvider sessionId="s1">
        <ToolExpandBody
          segment={bashSegment({
            result: "截断的输出",
            resultSourceLogId: "log-r",
            resultTruncated: true,
          })}
          running={false}
        />
      </SlimLogFullProvider>,
    );
    // 请求已发（单条全文端点，sessionId + 源行 log id）。
    expect(fullLogApi.getAgentSessionLogFull).toHaveBeenCalledWith("s1", "log-r");
    // loading 态：内联「正在加载全文…」提示 + 截断内容照常渲染。
    expect(screen.getByText("内容过长已截断，正在加载全文…")).toBeTruthy();
    expect(screen.getByText("截断的输出")).toBeTruthy();

    release({
      id: "log-r",
      run_id: "run-1",
      timestamp: "2026-09-27T10:00:00Z",
      channel: "tool_call",
      content_redacted: "完整的命令输出全文（远超 2000 字符的原文）",
    });
    // 回填落地：全文替换截断文本渲染，loading 提示消失。
    await waitFor(() =>
      expect(
        screen.getByText("完整的命令输出全文（远超 2000 字符的原文）"),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText("内容过长已截断，正在加载全文…"),
    ).toBeNull();
    expect(screen.queryByText("截断的输出")).toBeNull();
    cleanup();
  });

  it("截断 raw 展开回填：全文 JSON 替换后参数区可解析（截断 JSON 原本解析失败）", async () => {
    // 截断的 raw（JSON 被腰斩）——BashArgsDetail 解析不出 command，回填后可见。
    const fullRaw = JSON.stringify({
      tool_use_id: "tu-1",
      args: { command: "pnpm exec vitest run --changed" },
    });
    fullLogApi.getAgentSessionLogFull.mockResolvedValueOnce({
      id: "log-u",
      run_id: "run-1",
      timestamp: "2026-09-27T10:00:00Z",
      channel: "tool_call",
      content_redacted: fullRaw,
    });
    render(
      <SlimLogFullProvider sessionId="s1">
        <ToolExpandBody
          segment={bashSegment({
            raw: fullRaw.slice(0, 30),
            sourceLogId: "log-u",
            contentTruncated: true,
          })}
          running={false}
        />
      </SlimLogFullProvider>,
    );
    expect(fullLogApi.getAgentSessionLogFull).toHaveBeenCalledWith("s1", "log-u");
    await waitFor(() =>
      expect(screen.getByText("pnpm exec vitest run --changed")).toBeTruthy(),
    );
    cleanup();
  });

  it("回填失败：降级提示「全文加载失败，当前展示截断内容」，截断内容保留", async () => {
    fullLogApi.getAgentSessionLogFull.mockRejectedValueOnce(new Error("boom"));
    render(
      <SlimLogFullProvider sessionId="s1">
        <ToolExpandBody
          segment={bashSegment({
            result: "截断的输出",
            resultSourceLogId: "log-r",
            resultTruncated: true,
          })}
          running={false}
        />
      </SlimLogFullProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("全文加载失败，当前展示截断内容")).toBeTruthy(),
    );
    expect(screen.getByText("截断的输出")).toBeTruthy();
    cleanup();
  });
});
