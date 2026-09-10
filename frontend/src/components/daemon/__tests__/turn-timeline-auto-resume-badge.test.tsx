/**
 * 2026-09-10-auto-resume-interrupted-turn / FR-07：turn.autoResumeOf「自动续跑」
 * 徽标渲染（enrichDisplayTurns 回填 run.metadata.auto_resume_of 后的展示面）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TurnTimeline, type SessionTurnView } from "@/components/daemon/turn-timeline";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ children }: { children: string }) => (
    <div data-testid="markdown-text">{children}</div>
  ),
}));

function makeTurn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "继续任务",
    output: "好的，继续。",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    errorDetail: null,
    processItems: [],
    segments: [],
    turnStartedAt: 0,
    ...over,
  };
}

function renderTimeline(turns: SessionTurnView[]) {
  return render(
    <TurnTimeline
      turns={turns}
      viewMode="all"
      errorMsg={null}
      sessionStatus="active"
      pendingRequests={[]}
      dialogHistory={[]}
      onResend={vi.fn()}
      onSwitchProvider={vi.fn()}
      onDialogResolved={vi.fn()}
      hasOnlineProvider
      emptyProviderLabel="Claude"
    />,
  );
}

describe("turn-timeline 自动续跑徽标（autoResumeOf）", () => {
  beforeEach(() => {});
  afterEach(() => cleanup());

  it("autoResumeOf 非空 → 渲染「自动续跑」徽标（title 带源轮 id）", () => {
    renderTimeline([makeTurn({ autoResumeOf: "11111111-2222-3333-4444-555555555555" })]);
    const badge = screen.getByTestId("turn-auto-resume-badge");
    expect(badge.textContent).toBe("自动续跑");
    expect(badge.getAttribute("title")).toContain("11111111");
  });

  it("autoResumeOf 缺省/null → 不渲染（零回归）", () => {
    renderTimeline([makeTurn()]);
    expect(screen.queryByTestId("turn-auto-resume-badge")).toBeNull();
    renderTimeline([makeTurn({ autoResumeOf: null })]);
    expect(screen.queryByTestId("turn-auto-resume-badge")).toBeNull();
  });
});
