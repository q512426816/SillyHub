/**
 * 2026-10-10-session-turn-token-speed FR-03 / FR-04：轮尾速度段渲染
 * （TurnStatusBadge 路径，viewMode="all"）——终态轮双值可得显示
 * 「N tok/s」；运行中 / 缺时长不渲染（不伪造）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

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
    inputTokens: 8400,
    outputTokens: 1250,
    ctxTokens: null,
    apiDurationMs: 12500,
    errorDetail: null,
    processItems: [],
    segments: [],
    turnStartedAt: 0,
    ...over,
  };
}

function renderTimeline(
  turns: SessionTurnView[],
  viewMode: "all" | "conversation" = "all",
  variant?: "desktop" | "mobile",
) {
  return render(
    <TurnTimeline
      turns={turns}
      viewMode={viewMode}
      variant={variant}
      errorMsg={null}
      sessionStatus="active"
      dialogHistory={[]}
      onResend={vi.fn()}
      onSwitchProvider={vi.fn()}
      hasOnlineProvider
      emptyProviderLabel="Claude"
    />,
  );
}

describe("turn-timeline 轮尾 token 速度（FR-03/FR-04）", () => {
  beforeEach(() => {});
  afterEach(() => cleanup());

  it("终态轮双值可得 → token 计数后显示「· 100 tok/s」（1250 tok / 12.5s）", () => {
    const { container } = renderTimeline([makeTurn()]);
    expect(container.textContent).toContain("↓1,250 · 100 tok/s");
  });

  it("运行中轮有实时计时数据 → 显示速度（FR-07 运行中实时 tok/s）", () => {
    const { container } = renderTimeline([
      makeTurn({ status: "running", outputTokens: 625, apiDurationMs: 12500 }),
    ]);
    expect(container.textContent).toContain("· 50 tok/s");
  });

  it("运行中轮无 API 时长数据（cursor / 旧 daemon）→ 只显示 token 计数", () => {
    const { container } = renderTimeline([
      makeTurn({ status: "running", apiDurationMs: null }),
    ]);
    expect(container.textContent).toContain("↓1,250");
    expect(container.textContent).not.toContain("tok/s");
  });

  it("终态但缺 apiDurationMs（旧数据 / 无时长引擎）→ 不显示", () => {
    const { container } = renderTimeline([makeTurn({ apiDurationMs: null })]);
    expect(container.textContent).toContain("↓1,250");
    expect(container.textContent).not.toContain("tok/s");
  });

  it("对话视图（RoundDivider meta）同样追加速度段", () => {
    const { container } = renderTimeline([makeTurn()], "conversation");
    expect(container.textContent).toContain("↓1,250 · 100 tok/s");
  });
});

describe("variant 透传链端到端（2026-10-26-mobile-four-page-layout-fix task-05 / FR-02）", () => {
  afterEach(() => cleanup());

  it("variant=mobile 端到端：conversation 视图 RoundDivider meta 大数缩写真实生效（78,489→78.5k）", () => {
    const { container } = renderTimeline(
      [makeTurn({ status: "completed", inputTokens: 78489, outputTokens: 2170 })],
      "conversation",
      "mobile",
    );
    expect(container.textContent).toContain("↑78.5k");
    expect(container.textContent).toContain("↓2,170");
    expect(container.textContent).not.toContain("↑78,489");
  });

  it("desktop 锚：不传 variant（PC 会话页/dialog/悬浮宿主形态）meta 原样千分位不缩写", () => {
    const { container } = renderTimeline(
      [makeTurn({ status: "completed", inputTokens: 78489, outputTokens: 2170 })],
      "conversation",
    );
    expect(container.textContent).toContain("↑78,489");
    expect(container.textContent).not.toContain("78.5k");
  });
});
