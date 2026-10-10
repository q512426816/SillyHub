// 2026-10-10-dialog-qa-inplace：「对话」视图 ❓ 提问记录按时间戳穿插进对话流。
//
// 背景：原实现（turn-timeline.tsx 旧块）把该轮全部 AskUser 提问记录整组渲染在
// 轮头部、agent 回复正文之前——一轮多问（如 SillySpec 断点七连问）时序全丢，
// 用户实测「一股脑扔轮次顶部」。本文件锁定的契约：
//   1. v2 段路径（segments）：❓ 块按 dialog.created_at 与段时刻合并排序穿插
//      （两段之间的提问渲染在两段之间，晚于全部段的提问渲染在末段之后）；
//   2. 仅有提问、无对话段的轮也渲染 ❓ 块（旧行为的块同样不依赖段存在）；
//   3. 旧回退路径（segments undefined）：❓ 块仍渲染（旧行为不回归）；
//   4. 「全部」视图穿插行为零改动（AskUserToolCard 路径，已有用例覆盖，此处
//      仅断言对话视图块在全部视图不双画轻量块）。
//
// mock 口径：MarkdownText（next/dynamic jsdom 同步渲染 null）——照抄
// turn-timeline-conversation-file-card.test 惯例。
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView, SessionViewMode } from "../turn-timeline";
import type { TextTurnSegment } from "../turn-segment-views";
import type { SessionDialogRead } from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

function textSeg(id: string, text: string, startedAt: number | null): TextTurnSegment {
  return { kind: "text", id, text, streaming: false, startedAt };
}

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "开始设计",
    output: "已完成",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

function makeDialog(createdAtMs: number, overrides: Partial<SessionDialogRead> = {}): SessionDialogRead {
  return {
    id: `d-${createdAtMs}`,
    session_id: "sess-1",
    run_id: "run-1",
    request_id: `req-${createdAtMs}`,
    tool_name: "AskUserQuestion",
    dialog_kind: "AskUserQuestion",
    dialog_payload: { questions: [{ question: `第${createdAtMs}毫秒的问题？` }] },
    status: "answered",
    answer: { answers: [{ answer: "确认，继续" }] },
    created_at: new Date(createdAtMs).toISOString(),
    answered_at: new Date(createdAtMs).toISOString(),
    ...overrides,
  };
}

function renderProps(
  turns: SessionTurnView[],
  dialogHistory: SessionDialogRead[],
  viewMode: SessionViewMode = "conversation",
) {
  return {
    turns,
    viewMode,
    errorMsg: null,
    sessionStatus: "active" as const,
    pendingRequests: [],
    dialogHistory,
    onDialogResolved: () => {},
    onResend: () => {},
    onSwitchProvider: () => {},
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
  };
}

/** innerHTML 顺序断言：a 文本先于 b 文本出现（indexOf，均须存在）。 */
function expectOrderBefore(html: string, a: string, b: string) {
  const ia = html.indexOf(a);
  const ib = html.indexOf(b);
  expect(ia).toBeGreaterThanOrEqual(0);
  expect(ib).toBeGreaterThanOrEqual(0);
  expect(ia).toBeLessThan(ib);
}

afterEach(() => {
  cleanup();
});

describe("「对话」视图 ❓ 提问记录按时间穿插（2026-10-10-dialog-qa-inplace）", () => {
  it("两段之间的提问渲染在两段之间（created_at 落在段时刻中间）", () => {
    const { container } = render(
      <TurnTimeline
        {...renderProps(
          [
            makeTurn({
              segments: [textSeg("seg-a", "段一正文", 1000), textSeg("seg-b", "段二正文", 3000)],
            }),
          ],
          [makeDialog(2000)],
        )}
      />,
    );
    const html = container.innerHTML;
    expectOrderBefore(html, "段一正文", "❓ 第2000毫秒的问题？");
    expectOrderBefore(html, "❓ 第2000毫秒的问题？", "段二正文");
    // 作答文本同块可见。
    expect(screen.getByText(/确认，继续/)).toBeInTheDocument();
  });

  it("晚于全部段的提问渲染在末段之后（不再前置轮头部）", () => {
    const { container } = render(
      <TurnTimeline
        {...renderProps(
          [
            makeTurn({
              segments: [textSeg("seg-a", "段一正文", 1000), textSeg("seg-b", "段二正文", 3000)],
            }),
          ],
          [makeDialog(4000)],
        )}
      />,
    );
    const html = container.innerHTML;
    expectOrderBefore(html, "段一正文", "段二正文");
    expectOrderBefore(html, "段二正文", "❓ 第4000毫秒的问题？");
  });

  it("仅有提问、无对话段的轮也渲染 ❓ 块（不依赖段存在）", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ segments: [] })],
          [makeDialog(1500)],
        )}
      />,
    );
    expect(screen.getByTestId("dialog-qa-block")).toBeInTheDocument();
    expect(screen.getByText(/❓ 第1500毫秒的问题？/)).toBeInTheDocument();
  });

  it("旧回退路径（segments undefined）：❓ 块仍渲染，不回归", () => {
    const { container } = render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ segments: undefined, output: "旧数据答复" })],
          [makeDialog(1200)],
        )}
      />,
    );
    expect(screen.getByTestId("dialog-qa-block")).toBeInTheDocument();
    expect(screen.getByText(/旧数据答复/)).toBeInTheDocument();
    // 评审 P3-3 补强：回退路径保持旧位置（❓ 块在答复正文之前）。
    expectOrderBefore(container.innerHTML, "❓ 第1200毫秒的问题？", "旧数据答复");
  });

  it("畸形 dialog（QA 不可解析）+ 零对话段：不渲染孤头像行（评审 P3-4）", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ segments: [] })],
          [
            makeDialog(1500, {
              dialog_payload: { questions: [] },
              answer: { answers: [] },
            }),
          ],
        )}
      />,
    );
    expect(screen.queryByTestId("dialog-qa-block")).not.toBeInTheDocument();
    // 智能体头像列不挂载（无任何可渲染对话项）。
    expect(screen.queryByTitle("智能体")).not.toBeInTheDocument();
  });

  it("「全部」视图：轻量 ❓ 块不双画（AskUser 走工具卡路径）", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ segments: [textSeg("seg-a", "段一正文", 1000)] })],
          [makeDialog(2000)],
          "all",
        )}
      />,
    );
    expect(screen.queryByTestId("dialog-qa-block")).not.toBeInTheDocument();
  });
});
