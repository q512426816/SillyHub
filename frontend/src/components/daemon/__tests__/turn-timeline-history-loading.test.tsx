// 2026-10-23-session-first-load-ux / FR-01 / FR-03：首屏历史加载骨架屏契约单测。
//
// 锁定的行为：
//   1. FR-01 主路径：turns 为空且 historyLoading=true → 渲染轮次卡形状骨架
//      （data-testid=turn-history-skeleton），静态空态文案（「XX 已就绪」）不出现；
//   2. FR-01 退场：turns 非空（含预览卡形态）时骨架不渲染——加载指示与内容互斥，
//      outline 先到的会话由预览卡承载视觉，骨架必须让位；
//   3. FR-03：历史拉取终态空会话（historyLoading=false 或缺省）保持原空态文案，
//      不误显骨架（骨架只在「在飞」窗口出现）；
//   4. 缺省 prop 零回归：不传 historyLoading（dialog / /runtimes 等旧消费方）
//      行为与改前一致（空态文案）；
//   5. trajectory 视图空态分支同构接线（第三视图进入时同样有加载指示）。
//
// 测试纪律：同 turn-timeline-conversation-file-card.test.tsx 惯例 mock MarkdownText
// （next/dynamic ssr:false 在 jsdom 同步渲染为 null）。
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView, SessionViewMode } from "../turn-timeline";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "帮我导出报告",
    output: "已完成",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

function renderProps(turns: SessionTurnView[], viewMode: SessionViewMode = "conversation") {
  return {
    turns,
    viewMode,
    errorMsg: null,
    sessionStatus: "active" as const,
    dialogHistory: [],
    onResend: () => {},
    onSwitchProvider: () => {},
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
  };
}

afterEach(cleanup);

describe("TurnTimeline historyLoading 骨架屏（2026-10-23-session-first-load-ux）", () => {
  it("FR-01：turns 空且加载在飞 → 骨架屏在屏，空态文案不出现", () => {
    render(<TurnTimeline {...renderProps([])} historyLoading={true} />);

    const skeleton = screen.getByTestId("turn-history-skeleton");
    expect(skeleton).toBeTruthy();
    // 加载语义文案在场（动态指示的可读形态）。
    expect(within(skeleton).getByText(/正在加载会话历史/)).toBeTruthy();
    // 旧静态空态文案必须不出现——它会被误读为页面卡死（FR-01 禁止项）。
    expect(screen.queryByText(/已就绪/)).toBeNull();
    expect(screen.queryByText(/没有在线守护进程/)).toBeNull();
  });

  it("FR-01 退场：turns 非空时骨架不渲染（加载指示与内容互斥）", () => {
    render(
      <TurnTimeline {...renderProps([makeTurn()])} historyLoading={true} />,
    );

    expect(screen.queryByTestId("turn-history-skeleton")).toBeNull();
    // 内容照常渲染（轮块在场）。
    expect(screen.getAllByTestId("turn-block").length).toBe(1);
  });

  it("FR-03：历史拉取终态（historyLoading=false）空会话保持原空态文案", () => {
    render(<TurnTimeline {...renderProps([])} historyLoading={false} />);

    expect(screen.queryByTestId("turn-history-skeleton")).toBeNull();
    expect(screen.getByText(/Claude Code 已就绪/)).toBeTruthy();
  });

  it("缺省 prop 零回归：不传 historyLoading 的旧消费方行为不变", () => {
    render(<TurnTimeline {...renderProps([])} />);

    expect(screen.queryByTestId("turn-history-skeleton")).toBeNull();
    expect(screen.getByText(/Claude Code 已就绪/)).toBeTruthy();
  });

  it("trajectory 视图：加载在飞同样渲染骨架屏", () => {
    render(
      <TurnTimeline
        {...renderProps([], "trajectory")}
        historyLoading={true}
      />,
    );

    expect(screen.getByTestId("turn-history-skeleton")).toBeTruthy();
    expect(screen.queryByText(/已就绪/)).toBeNull();
  });
});
