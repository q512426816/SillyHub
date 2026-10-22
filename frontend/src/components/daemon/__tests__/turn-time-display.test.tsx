/**
 * quick-3c85b05e（2026-09-15 轮次时间三段显示）：会话轮次时间与运行中状态条
 * 「开始时刻」单测。悬浮对话（floating-session-host）与门户会话共用 SessionPanel
 * → TurnTimeline/TurnStatusBar 内核，本文件即两宿主的共享契约。
 *
 * 2026-10-20-session-page-dsh-alignment（FR-01 / D-016①）后契约变更为「一轮只有
 * 一条元信息行」：原先轮尾另有独立一行「开始 · 结束 · 历时」，与轮尾状态行
 * （第 N 轮 · 状态 · tokens · tok/s）重复；现两者合并——时间细节折进状态行右端
 * （对话视图 RoundDivider.detail / 全部视图 turn-meta-detail）。
 *
 * 锁定：
 *   1. 完成轮（turnStartedAt + replyAt 双锚点）：**唯一**一条元信息行同时含
 *      轮号 / 状态 / 结束 HH:MM:SS / 历时 mm:ss（不再有第二行时间信息）；
 *   2. 仅 replyAt（旧数据无开始锚点）：回退单显结束时间（既有行为保持，无开始/
 *      历时字样）；
 *   3. 运行中（TurnStatusBar）：锚点存在即显「开始 HH:MM:SS」（与走秒 ≥15s
 *      门槛解耦——刚开跑也显示开始时刻）。
 *
 * 测试纪律同 turn-timeline-conversation-file-card.test.tsx：mock MarkdownText
 * （next/dynamic ssr:false 在 jsdom 同步渲染为 null）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TurnTimeline } from "../turn-timeline";
import { TurnStatusBar } from "../turn-status-bar";
import type { SessionTurnView, SessionViewMode } from "../turn-timeline";
import type { TextTurnSegment } from "../turn-segment-views";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/** 本地时区 HH:MM:SS 派生（期望值与实现同源算法，环境时区无关）。 */
function localHms(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 锚定「今天 10:00 本地」——与实现 formatTurnTimeSec 的 sameDay 判定同日，
// 输出恒为 HH:MM:SS（无 MM-DD 前缀），期望值确定。
const startAnchor = new Date();
startAnchor.setHours(10, 0, 0, 0);
const START_MS = startAnchor.getTime();
const END_ISO = new Date(START_MS + 96_000).toISOString(); // 历时 01:36

const TEXT_SEG: TextTurnSegment = {
  kind: "text",
  id: "seg-text-1",
  text: "已完成",
  streaming: false,
  startedAt: START_MS,
};

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "帮我查一下",
    output: "已完成",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    segments: [TEXT_SEG],
    turnStartedAt: START_MS,
    replyAt: END_ISO,
    ...overrides,
  };
}

function renderProps(turns: SessionTurnView[], viewMode: SessionViewMode = "conversation") {
  return {
    turns,
    viewMode,
    errorMsg: null,
    sessionStatus: "active" as const,
    pendingRequests: [],
    dialogHistory: [],
    onDialogResolved: () => {},
    onResend: () => {},
    onSwitchProvider: () => {},
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
  };
}

describe("轮次时间三段显示（quick-3c85b05e；2026-10-20 合并为一条元信息行）", () => {
  it("完成轮双锚点：轮号/状态/结束/历时 全在同一条元信息行内（对话视图；悬浮对话共用内核）", () => {
    render(<TurnTimeline {...renderProps([makeTurn()])} />);
    const row = screen.getByTestId("round-divider");
    // 轮号 + 状态 + 时间细节（结束/历时）合并同一行——此行即整轮唯一元信息行。
    expect(row.textContent).toContain("第 1 轮");
    expect(row.textContent).toContain("已完成");
    const detail = screen.getByTestId("round-divider-detail");
    expect(detail).toHaveTextContent(`开始 ${localHms(START_MS)}`);
    expect(detail).toHaveTextContent(`结束 ${localHms(Date.parse(END_ISO))}`);
    expect(detail).toHaveTextContent("历时 01:36");
    // 时间细节在行尾（右对齐）：其父容器是 round-divider 的右半区。
    expect(row.contains(detail)).toBe(true);
    // ①「一轮只有一条元信息行」：整页「历时」只出现一次，且唯一的「结束」节点
    // 就是这条元信息行的行尾细节（旧的独立时间行已删除，不再有第二个存放点）。
    expect(screen.getAllByText(/历时 01:36/)).toHaveLength(1);
    const endNodes = screen.getAllByText(/结束 \d{2}:\d{2}:\d{2}/);
    expect(endNodes).toHaveLength(1);
    expect(endNodes[0]).toBe(detail);
    expect(screen.queryAllByTestId("turn-meta-detail")).toHaveLength(0);
  });

  it("进度视图（all）同样只有一条元信息行：状态徽章 + 右对齐时间细节", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "all")} />);
    const detail = screen.getByTestId("turn-meta-detail");
    expect(detail).toHaveTextContent("历时 01:36");
    expect(detail.className).toContain("ml-auto"); // 右对齐（贴行尾）
    expect(detail.className).toContain("text-[10.5px]");
    expect(detail.className).toContain("font-mono");
    expect(screen.getAllByText(/历时 01:36/)).toHaveLength(1);
    // 全部视图走 TurnStatusBadge 行，不再挂 RoundDivider。
    expect(screen.queryAllByTestId("round-divider")).toHaveLength(0);
  });

  it("仅 replyAt（旧数据无开始锚点）：回退单显结束时间，无开始/历时字样", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ turnStartedAt: null, replyAt: END_ISO })])}
      />,
    );
    const detail = screen.getByTestId("round-divider-detail");
    expect(detail).toHaveTextContent(`结束 ${localHms(Date.parse(END_ISO))}`);
    expect(screen.queryByText(/开始 /)).toBeNull();
    expect(screen.queryByText(/历时/)).toBeNull();
  });

  it("运行中状态条：锚点存在即显「开始 HH:MM:SS」（与走秒 ≥15s 门槛解耦）", () => {
    // 锚点 5s 前（<15s 走秒不显示），开始时刻仍应显示。
    render(
      <TurnStatusBar
        turnStartedAt={Date.now() - 5_000}
        segments={[TEXT_SEG]}
        turnStatus="running"
      />,
    );
    expect(screen.getByText(/开始 \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    // <15s：不显走秒 mm:ss（既有门槛保持）。
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
  });

  it("运行中状态条无锚点：不显开始时刻（容错不显示，既有语义）", () => {
    render(
      <TurnStatusBar turnStartedAt={null} segments={[TEXT_SEG]} turnStatus="running" />,
    );
    expect(screen.queryByText(/开始 /)).toBeNull();
  });
});

/**
 * 2026-10-21 用户裁决（两条视觉方向）：「轮间 1px hairline 多余」+「对比加强」。
 * 本组锁定两条契约的**可量化落点**：
 *   1. 轮间分隔只有留白（pb-7 = 28px），turn-block 不再有任何 border；
 *      globals.css 也不得再对轮次容器画线（防「组件删了、样式还在」的回潮）；
 *   2. 助手列（过程行 + 答复正文同列）分两区：行间单值 7px，答复块额外上留 7px
 *      → 过程块与答复块的实际间隔 14px，过程行彼此仍紧凑。
 */
describe("轮间节奏与助手列分区（2026-10-21 视觉裁决）", () => {
  it("轮间只有留白：turn-block 无 border-b（含 last:border-b-0 已移除），保留 pb-7 的 28px", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn(),
          makeTurn({ runId: "run-2", turn: 2 }),
          makeTurn({ runId: "run-3", turn: 3 }),
        ])}
      />,
    );
    const blocks = screen.getAllByTestId("turn-block");
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      // 留白仍在（28px 分节）
      expect(block.className).toContain("pb-7");
      // 线全部消失：不分首末轮，任何 border-b / border-border 都不该出现
      expect(block.className).not.toContain("border-b");
      expect(block.className).not.toContain("border-border");
      expect(block.className).not.toContain("last:");
    }
  });

  it("globals.css 无残留轮间画线规则（轮间分节只由组件留白承担）", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    expect(css).not.toContain("turn-block");
    expect(css).not.toContain("[data-turn-key]");
  });

  it("助手列分区：过程行间距 gap-[7px]，答复块额外上留 7px（两区实际间隔 14px）", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "all")} />);
    const column = screen.getByTestId("turn-progress-column");
    const classes = new Set(column.className.split(/\s+/));
    // 单一 spacing 值 7px：行间节奏
    expect(classes.has("gap-[7px]")).toBe(true);
    expect(classes.has("gap-1.5")).toBe(false); // 旧的 6px 等距不再
    // 答复正文块（.seg-text-body 是列的直接子元素）额外 7px 上留 → 区间隔 7+7=14px
    expect(classes.has("[&>.seg-text-body]:mt-[7px]")).toBe(true);
    // 列本体仍是既有形态（ml-9 + flex-col），不是新造容器
    expect(classes.has("ml-9")).toBe(true);
    expect(classes.has("flex-col")).toBe(true);
  });
});