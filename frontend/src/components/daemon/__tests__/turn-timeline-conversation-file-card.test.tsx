// quick-d12af6dd（agent-file-upload-mcp FR-01 补漏）：「对话」视图渲染 agent 上传
// 文件卡片单测。
//
// 背景：task-08 实现把文件卡片只挂在「全部」视图（v2 段线 / TurnDetailsList），
// 而会话默认视图是 conversation——文件卡片对用户完全不可见，违背设计目标
// 「聊天流中出现文件卡片，用户可查看/下载」。本文件锁定的契约：
//   1. v2 路径（segments）对话视图：text 段与 file 段渲染（SegmentView 分流），
//      thinking 段仍不挂载（渲染经济 FR-06 不回归）；
//   2. 旧路径（processItems 回退）对话视图：file 过程项在答复气泡后渲染
//      FileMessageCard，thinking 仍只在「全部」视图；
//   3. 「全部」视图双路径行为不回归（thinking 可见 + 文件卡片可见）。
//
// 测试纪律：同 turn-segment-views.test.tsx 惯例 mock MarkdownText（next/dynamic
// ssr:false 在 jsdom 同步渲染为 null）与 FileMessageCard（卡片本体两形态由
// file-message-card.test.tsx 专项覆盖，本文件只锁视图归属）。
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView, SessionViewMode } from "../turn-timeline";
import type {
  FileTurnSegment,
  TextTurnSegment,
  ThinkingTurnSegment,
} from "../turn-segment-views";
import type { TurnSegment } from "../session-log-assembler";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

vi.mock("@/components/daemon/file-message-card", () => ({
  FileMessageCard: (props: Record<string, unknown>) => (
    <div
      data-testid="file-message-card"
      data-file-id={String(props.fileId)}
      data-name={String(props.name)}
    />
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
    pendingRequests: [],
    dialogHistory: [],
    onDialogResolved: () => {},
    onResend: () => {},
    onSwitchProvider: () => {},
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
  };
}

const TEXT_SEG: TextTurnSegment = {
  kind: "text",
  id: "seg-text-1",
  text: "报告已生成并上传",
  streaming: false,
  startedAt: null,
};

const THINK_SEG: ThinkingTurnSegment = {
  kind: "thinking",
  id: "seg-think-1",
  text: "内部思考内容",
  streaming: false,
  ts: null,
};

const FILE_SEG: FileTurnSegment = {
  kind: "file",
  id: "seg-file-1",
  fileId: "f-uuid-1",
  name: "report.png",
  size: 1024,
  mime: "image/png",
  description: "报告图",
  ts: 1787400000000,
};

afterEach(() => {
  cleanup();
});

describe("「对话」视图渲染文件卡片（quick-d12af6dd / FR-01）", () => {
  it("v2 路径：text/file 段渲染，thinking 段不挂载（渲染经济）", () => {
    const segments: TurnSegment[] = [THINK_SEG, TEXT_SEG, FILE_SEG];
    render(<TurnTimeline {...renderProps([makeTurn({ segments })])} />);
    expect(screen.getByTestId("file-message-card")).toHaveAttribute(
      "data-file-id",
      "f-uuid-1",
    );
    expect(screen.getByText("agent 上传了文件")).toBeInTheDocument();
    expect(screen.getByText("报告已生成并上传")).toBeInTheDocument();
    expect(screen.queryByText("内部思考内容")).not.toBeInTheDocument();
  });

  it("旧路径：file 过程项在答复气泡后渲染卡片，thinking 仍不可见", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({
            segments: undefined,
            output: "答复正文",
            processItems: [
              { kind: "thinking", text: "内部思考内容" },
              {
                kind: "file",
                fileId: "f-uuid-2",
                name: "data.csv",
                size: 2048,
                mime: "text/csv",
                description: null,
              },
            ],
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("file-message-card")).toHaveAttribute(
      "data-file-id",
      "f-uuid-2",
    );
    expect(screen.getByText("agent 上传了文件")).toBeInTheDocument();
    expect(screen.getByText("答复正文")).toBeInTheDocument();
    expect(screen.queryByText("内部思考内容")).not.toBeInTheDocument();
  });

  it("「全部」视图双路径不回归：thinking 与文件卡片均可见", () => {
    const { rerender } = render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: [THINK_SEG, FILE_SEG] })], "all")}
      />,
    );
    // v2 全部视图：thinking 折叠头 + 文件卡片
    expect(screen.getByTestId("file-message-card")).toBeInTheDocument();
    expect(screen.getByText("💭 思考过程")).toBeInTheDocument();

    rerender(
      <TurnTimeline
        {...renderProps(
          [
            makeTurn({
              segments: undefined,
              output: "答复正文",
              processItems: [
                { kind: "thinking", text: "内部思考内容" },
                {
                  kind: "file",
                  fileId: "f-uuid-3",
                  name: "a.md",
                  size: 10,
                  mime: "text/markdown",
                  description: null,
                },
              ],
            }),
          ],
          "all",
        )}
      />,
    );
    // 旧路径全部视图：TurnDetailsList 合并 thinking + 文件卡片
    expect(screen.getByTestId("file-message-card")).toHaveAttribute(
      "data-file-id",
      "f-uuid-3",
    );
    expect(screen.getByText("思考过程")).toBeInTheDocument();
  });
});
