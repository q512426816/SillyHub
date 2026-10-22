// 2026-10-22-session-trajectory-third-view（D-001，覆盖 D-035 两态约束）：
// 会话视图三态中的「轨迹」——与「对话 / 进度」同层并列，不再是进度内的第二层开关。
//
// 锁定：
//   1. 「进度」恢复纯时间线：轮块照常、不再有 progress-lens；
//   2. 「轨迹」直接渲染三泳道面板，轮块让位（不双画）；
//   3. 轨迹面板选中交互（并入 2026-10-22-fix-trajectory-row-select）：点击账本行 /
//      时间轴条目选中，右侧检查器出详情，↑/↓ 切换、Esc 清除；
//   4. 无可绘制时序 → 显式空态（trajectory-empty），不白屏、不伪造条；
//   5. 「对话」视图不出现轨迹面板（零回归）。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView, SessionViewMode } from "../turn-timeline";

// jsdom 未实现 scrollIntoView（TrajectoryView 选中行「滚入视野」effect 会调用）。
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const START = Date.parse("2026-10-21T10:00:00.000Z");
const END_ISO = new Date(START + 60_000).toISOString();

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "跑一下测试",
    output: "好了",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: 10,
    outputTokens: 20,
    turnStartedAt: START,
    replyAt: END_ISO,
    segments: [
      { kind: "thinking", id: "th-1", text: "想一下", streaming: false, ts: START + 1_000 },
      {
        kind: "tool",
        id: "tool-1",
        raw: "{}",
        status: "ok",
        toolName: "Bash",
        primary: "pnpm test",
        startedAt: START + 5_000,
        endedAt: START + 20_000,
        children: [],
        subagentType: null,
      },
      { kind: "text", id: "tx-1", text: "好了", streaming: false, startedAt: START + 30_000 },
    ],
    ...overrides,
  };
}

function renderProps(turns: SessionTurnView[], viewMode: SessionViewMode) {
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

describe("会话视图三态中的「轨迹」（D-001）", () => {
  it("进度视图纯时间线：轮块照常渲染、无「时间线 / 轨迹」第二层开关", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "all")} />);

    expect(screen.getAllByTestId("turn-block").length).toBe(1);
    expect(screen.queryByTestId("progress-lens")).toBeNull();
    expect(screen.queryByTestId("trajectory-pane")).toBeNull();
  });

  it("轨迹视图直接出三泳道面板、轮块让位", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "trajectory")} />);

    expect(screen.getByTestId("trajectory-pane")).toBeInTheDocument();
    // 三泳道（输入 / 模型 / 工具）随 TrajectoryView 一起出现。
    expect(screen.getAllByTestId("trajectory-lane-label").length).toBe(3);
    expect(screen.queryByTestId("turn-block")).toBeNull();
    // 不再有进度内的第二层开关。
    expect(screen.queryByTestId("progress-lens")).toBeNull();
  });

  it("无 timing 采样 → 模型泳道标「近似」；有 timing → 标「真实占用」", () => {
    const { unmount } = render(
      <TurnTimeline {...renderProps([makeTurn()], "trajectory")} />,
    );
    expect(screen.getByTestId("trajectory-model-basis").textContent).toContain("近似");
    unmount();

    // 带真实 attempts 的轮：observed（模型条取 attempt 区间）。attempt 时间戳是
    // ISO 字符串（与 `/runs` 的 `TurnTimingSnapshot` 同形）。
    render(
      <TurnTimeline
        {...renderProps(
          [
            makeTurn({
              timing: {
                runId: "run-1",
                basis: "observed",
                ttftMs: 800,
                totalMs: 60_000,
                attempts: [
                  {
                    index: 1,
                    startedAt: new Date(START).toISOString(),
                    firstTokenAt: new Date(START + 800).toISOString(),
                    endedAt: new Date(START + 4_000).toISOString(),
                    model: "claude-x",
                    inputTokens: 10,
                    outputTokens: 20,
                  },
                ],
              } as SessionTurnView["timing"],
            }),
          ],
          "trajectory",
        )}
      />,
    );
    expect(screen.getByTestId("trajectory-model-basis").textContent).toContain("真实占用");
  });

  it("点击账本行 → 选中态 + 右侧检查器显示行详情", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "trajectory")} />);

    const rows = screen.getAllByTestId("trajectory-row");
    // 首行是用户输入行（prompt），检查器应显示其「输入」正文。
    fireEvent.click(rows[0]!);

    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    // 2026-10-22-trajectory-view-redesign：详情按行类型分档——用户行是
    // 「概述 / 原始内容」两档，正文在原始内容标签下。
    const inspector = screen.getByLabelText("行详情");
    expect(inspector.textContent).toContain("概述");
    fireEvent.click(screen.getByRole("tab", { name: "原始内容" }));
    expect(inspector.textContent).toContain("跑一下测试");
  });

  it("点击时间轴条目 → 对应账本行选中", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "trajectory")} />);

    const bar = screen.getAllByTestId("trajectory-bar")[0]!;
    const rowId = bar.getAttribute("data-row-id");
    expect(rowId).toBeTruthy();

    fireEvent.click(bar);

    const row = screen
      .getAllByTestId("trajectory-row")
      .find((item) => item.getAttribute("data-row-id") === rowId);
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("↑/↓ 切换选中、Esc 清除", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "trajectory")} />);

    const grid = screen.getByTestId("trajectory-grid");
    const rows = screen.getAllByTestId("trajectory-row");

    // 未选中时 ↓ 选首行，再 ↓ 选第二行。
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");

    // Esc 清除选中，检查器回落空提示。
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(rows.every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
    // 新设计：无选中行时整个详情面板不渲染（D-005）。
    expect(screen.queryByTestId("trajectory-detail-panel")).toBeNull();
  });

  it("无可绘制时序（无时间锚点）→ 轨迹视图显式空态，不白屏、不渲染轮块", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ turnStartedAt: null, replyAt: null, segments: [] })],
          "trajectory",
        )}
      />,
    );

    expect(screen.getByTestId("trajectory-empty").textContent).toContain(
      "没有可绘制的时间数据",
    );
    expect(screen.queryByTestId("trajectory-pane")).toBeNull();
    expect(screen.queryByTestId("turn-block")).toBeNull();
  });

  it("对话视图不出现轨迹面板（零回归）", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "conversation")} />);

    expect(screen.getAllByTestId("turn-block").length).toBe(1);
    expect(screen.queryByTestId("trajectory-pane")).toBeNull();
    expect(screen.queryByTestId("progress-lens")).toBeNull();
  });
});
