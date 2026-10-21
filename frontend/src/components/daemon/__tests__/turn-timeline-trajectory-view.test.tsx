// 2026-10-22-session-trajectory-view（D-035）：会话页「进度」视图内的轨迹呈现。
//
// 锁定（按用户 2026-10-22 裁决改版）：
//   1. 视图模式**仍是两态**（对话 / 进度）——轨迹是进度视图内的呈现方式，不是第三种视图；
//   2. 进度视图出现「时间线 / 轨迹」开关（progress-lens），默认「时间线」不改变现状；
//   3. 切「轨迹」→ 渲染三泳道面板（trajectory-pane），轮块列表让位（不双画）；
//   4. 无可绘制时序 → 显式空态（trajectory-empty），不白屏、不伪造条；
//   5. 对话视图不出现该开关（零回归）。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView, SessionViewMode } from "../turn-timeline";

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

describe("进度视图内的轨迹呈现（D-035，用户裁决：不做第三视图）", () => {
  it('进度视图默认「时间线」：轮块照常渲染、不出轨迹面板（现状零变化）', () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "all")} />);

    const lens = screen.getByTestId("progress-lens");
    expect(lens).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "时间线" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByTestId("turn-block").length).toBe(1);
    expect(screen.queryByTestId("trajectory-pane")).toBeNull();
  });

  it('点「轨迹」→ 三泳道面板在场、轮块列表让位', () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "all")} />);
    fireEvent.click(screen.getByRole("tab", { name: "轨迹" }));

    expect(screen.getByTestId("trajectory-pane")).toBeInTheDocument();
    // 三泳道（输入 / 模型 / 工具）随 TrajectoryView 一起出现。
    expect(screen.getAllByTestId("trajectory-lane-label").length).toBe(3);
    expect(screen.queryByTestId("turn-block")).toBeNull();
  });

  it("无 timing 采样 → 模型泳道标「近似」；有 timing → 标「真实占用」", () => {
    const { unmount } = render(<TurnTimeline {...renderProps([makeTurn()], "all")} />);
    fireEvent.click(screen.getByRole("tab", { name: "轨迹" }));
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
          "all",
        )}
      />,
    );
    fireEvent.click(screen.getAllByRole("tab", { name: "轨迹" })[0]!);
    expect(screen.getByTestId("trajectory-model-basis").textContent).toContain("真实占用");
  });

  it("无可绘制时序（无时间锚点）→ 显式空态，不白屏、不渲染轮块", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ turnStartedAt: null, replyAt: null, segments: [] })],
          "all",
        )}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "轨迹" }));

    expect(screen.getByTestId("trajectory-empty").textContent).toContain(
      "没有可绘制的时间数据",
    );
    expect(screen.queryByTestId("trajectory-pane")).toBeNull();
    expect(screen.queryByTestId("turn-block")).toBeNull();
  });

  it("对话视图不出现「时间线 / 轨迹」开关（两态视图零回归）", () => {
    render(<TurnTimeline {...renderProps([makeTurn()], "conversation")} />);
    expect(screen.queryByTestId("progress-lens")).toBeNull();
    expect(screen.getAllByTestId("turn-block").length).toBe(1);
  });
});
