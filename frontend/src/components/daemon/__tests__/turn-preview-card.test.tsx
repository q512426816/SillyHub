/**
 * task-02 / task-04（2026-10-14-session-turn-preview-cards）：TurnPreviewCard
 * 渲染与交互测试——预览卡内容（轮号/状态/时间/摘要）/点击展开回调/未接线零回归
 * （task-02），预取判重与大纲缺失降级在 task-03 接线后由 task-04 追加（本文件
 * target_files 双卡共享）。
 *
 * 测试纪律同 turn-time-display.test.tsx：mock MarkdownText（next/dynamic ssr:false
 * 在 jsdom 同步渲染为 null）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView } from "../turn-timeline";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

function previewTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-prev-1",
    turn: 3,
    prompt: "",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    errorDetail: null,
    realRunId: "run-prev-1",
    preview: {
      promptSummary: "CardMarkdown 薄壳组件是怎么实现的？",
      answerSummary: "CardMarkdown 是一个只负责渲染的展示组件…",
      startedAt: "2026-09-23T04:13:00Z",
    },
    ...overrides,
  };
}

function renderProps(turns: SessionTurnView[], expandPreview?: (_runKey: string) => void) {
  return {
    turns,
    viewMode: "conversation" as const,
    errorMsg: null,
    sessionStatus: "active" as const,
    dialogHistory: [],
    onResend: () => {},
    onSwitchProvider: () => {},
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
    expandPreview,
  };
}

describe("TurnPreviewCard 渲染（task-02 / FR-01）", () => {
  it("渲染轮号/未加载标记/提问摘要/答复摘要/展开入口", () => {
    render(<TurnTimeline {...renderProps([previewTurn()], vi.fn())} />);
    const card = screen.getByTestId("turn-preview-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("第 3 轮");
    expect(card).toHaveTextContent("未加载 · 点击展开");
    expect(card).toHaveTextContent("CardMarkdown 薄壳组件是怎么实现的？");
    expect(card).toHaveTextContent("CardMarkdown 是一个只负责渲染的展示组件…");
    expect(card).toHaveTextContent("展开完整对话");
  });

  it("data-turn-key 锚点 = realRunId（与加载后真实块同源）", () => {
    render(
      <TurnTimeline
        {...renderProps([previewTurn({ runId: "pseudo-1", realRunId: "real-1" })], vi.fn())}
      />,
    );
    expect(screen.getByTestId("turn-preview-card")).toHaveAttribute(
      "data-turn-key",
      "real-1",
    );
  });

  it("无摘要轮 aria-label 兜底「（无内容记录）」（对齐 turn-nav EMPTY_HINT 口径）", () => {
    render(
      <TurnTimeline
        {...renderProps([
          previewTurn({ preview: { startedAt: "2026-09-23T04:13:00Z" } }),
        ], vi.fn())}
      />,
    );
    expect(screen.getByTestId("turn-preview-card").getAttribute("aria-label")).toContain(
      "（无内容记录）",
    );
  });

  it("运行中预览轮状态点语义与 aria 状态文案（running → 运行中）", () => {
    render(
      <TurnTimeline {...renderProps([previewTurn({ status: "running" as const })], vi.fn())} />,
    );
    expect(screen.getByTestId("turn-preview-card").getAttribute("aria-label")).toContain(
      "运行中",
    );
  });
});

describe("TurnPreviewCard 交互（task-02 / FR-02）", () => {
  it("点击卡片上抛 onExpandPreview 且实参 = runKey", () => {
    const onExpand = vi.fn();
    render(<TurnTimeline {...renderProps([previewTurn()], onExpand)} />);
    fireEvent.click(screen.getByTestId("turn-preview-card"));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith("run-prev-1");
  });

  it("未接线（expandPreview 缺省）预览轮回落既有分支：不渲染预览卡也不崩", () => {
    const props = renderProps([previewTurn()]);
    delete (props as { expandPreview?: unknown }).expandPreview;
    render(<TurnTimeline {...props} />);
    expect(screen.queryByTestId("turn-preview-card")).not.toBeInTheDocument();
  });

  it("真实轮（无 preview 字段）不受 expandPreview 接线影响照常渲染", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [
            previewTurn({
              runId: "real-run",
              prompt: "真实用户消息",
              output: "真实答复",
              preview: undefined,
            }),
          ],
          vi.fn(),
        )}
      />,
    );
    expect(screen.queryByTestId("turn-preview-card")).not.toBeInTheDocument();
    expect(screen.getByText("真实用户消息")).toBeInTheDocument();
  });
});
