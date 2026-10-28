/**
 * 2026-10-28-model-retry-visible / FR-02：model_retry 段的对话视图轮状态门控。
 *
 * 锁定：
 *   1. 运行中轮（status=running）对话视图渲染「模型限流重试中」实时提示行；
 *   2. 终态轮（status=completed）对话视图不渲染重试行（对话正文干净；
 *      失败原因由 RunErrorItem 失败卡承担——该卡为既有行为不在本测试面）；
 *   3. 「全部（进度）」视图保留过程行（终态轮也可见，FR-02 允许面）。
 *
 * harness 复用 turn-timeline-auto-resume-badge.test.tsx 的 makeTurn/renderTimeline
 * 范式（SessionTurnView 最小构造 + TurnTimeline 直render）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TurnTimeline, type SessionTurnView } from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ children }: { children: string }) => (
    <div data-testid="markdown-text">{children}</div>
  ),
}));

const RETRY_SEG: TurnSegment = {
  kind: "model_retry",
  id: "seg:mr-gate",
  text: JSON.stringify({
    attempt: 3,
    max_retries: 10,
    retry_delay_ms: 8000,
    error_status: 429,
    error: "Request rejected (429) · [1311][当前订阅套餐暂未开放GLM-5.3]",
  }),
  ts: 1_000,
};

function makeTurn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-retry",
    turn: 1,
    prompt: "排查问题",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    errorDetail: null,
    processItems: [],
    segments: [RETRY_SEG],
    turnStartedAt: 1_000,
    ...over,
  };
}

function renderTimeline(turns: SessionTurnView[], viewMode: "conversation" | "all") {
  return render(
    <TurnTimeline
      turns={turns}
      viewMode={viewMode}
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

describe("model_retry 段对话视图轮状态门控（2026-10-28-model-retry-visible / FR-02）", () => {
  afterEach(() => cleanup());

  it("运行中轮 + 对话视图：渲染「模型限流重试中 第3/10次」实时提示行", () => {
    renderTimeline([makeTurn({ status: "running" })], "conversation");
    expect(screen.getByTestId("model-retry-row")).toHaveTextContent(
      "模型限流重试中 第3/10次",
    );
  });

  it("终态轮 + 对话视图：不渲染重试行（对话正文干净）", () => {
    renderTimeline([makeTurn({ status: "completed" })], "conversation");
    expect(screen.queryByTestId("model-retry-row")).toBeNull();
  });

  it("「全部（进度）」视图：终态轮保留重试过程行（FR-02 允许面）", () => {
    renderTimeline([makeTurn({ status: "completed" })], "all");
    expect(screen.getByTestId("model-retry-row")).toHaveTextContent("模型限流重试中");
  });
});
