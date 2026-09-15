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
//   3. 「全部」视图双路径行为不回归（thinking 可见 + 文件卡片可见）；
//   4. task-02（2026-09-15-subagent-three-pane-display / FR-04 / D-002@v1 ①）：
//      对话视图过滤放宽——子代理容器段（tool 带 children / subagent_stub）进入
//      对话流渲染子代理块；thinking/普通 tool/dispatch_worker 团队分身段仍被
//      过滤（渲染经济与团队卡归属「全部」视图均不回归）。
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
import type {
  StubTurnSegment,
  ToolTurnSegment,
  TurnSegment,
} from "../session-log-assembler";

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

/* task-02（2026-09-15-subagent-three-pane-display / FR-04 / D-002@v1 ①）：
 * 子代理容器段 fixtures——tool 段带 children（子代理归属）与 subagent_stub
 * 兜底段两形态；另备普通 tool（无 children）与 dispatch_worker 团队分身段
 * 作对照（两者均不得进对话视图）。 */
const SUBAGENT_TOOL_SEG: ToolTurnSegment = {
  kind: "tool",
  id: "seg-tool-sub-1",
  raw: '{"name":"Agent","args":{"subagent_type":"code"}}',
  result: "子代理执行完成",
  status: "ok",
  toolName: "Agent",
  primary: "代码审查员",
  startedAt: 1787400000000,
  endedAt: 1787400060000,
  children: [
    {
      kind: "text",
      id: "seg-sub-text-1",
      text: "子代理内部产出正文",
      streaming: false,
      startedAt: null,
    },
  ],
  subagentType: "code",
};

const SUBAGENT_STUB_SEG: StubTurnSegment = {
  kind: "subagent_stub",
  id: "seg-stub-1",
  subagentType: "researcher",
  children: [
    {
      kind: "text",
      id: "seg-stub-text-1",
      text: "stub 子代理产出正文",
      streaming: false,
      startedAt: null,
    },
  ],
};

const PLAIN_TOOL_SEG: ToolTurnSegment = {
  kind: "tool",
  id: "seg-tool-plain-1",
  raw: '{"name":"Read","args":{"file_path":"plain-tool-target.txt"}}',
  status: "ok",
  toolName: "Read",
  primary: "plain-tool-target.txt",
  startedAt: null,
  endedAt: null,
  children: [],
  subagentType: null,
};

const TEAM_DISPATCH_SEG: ToolTurnSegment = {
  kind: "tool",
  id: "seg-tool-team-1",
  raw: '{"name":"mcp__sillyhub__dispatch_worker","args":{"role":"资料调研员","objective":"收集竞品资料"}}',
  status: "ok",
  toolName: "mcp__sillyhub__dispatch_worker",
  primary: "资料调研员 · 收集竞品资料",
  startedAt: 1787400000000,
  endedAt: 1787400060000,
  children: [
    {
      kind: "text",
      id: "seg-team-text-1",
      text: "分身归属日志正文",
      streaming: false,
      startedAt: null,
    },
  ],
  subagentType: null,
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

describe("对话视图子代理容器段（2026-09-15-subagent-three-pane task-02 / FR-04）", () => {
  it("conversation 模式：tool 段带 children（子代理归属）渲染子代理块（🤖 + 名称），完成态默认折叠不挂载 children", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: [SUBAGENT_TOOL_SEG] })])}
      />,
    );
    // 子代理块头进入对话流（SegmentView 分发到 SubagentBlockView，渲染侧零改动）
    expect(screen.getByText("🤖")).toBeInTheDocument();
    expect(screen.getByText("代码审查员")).toBeInTheDocument(); // 名称 = primary
    expect(screen.getByText("code")).toBeInTheDocument(); // subagentType 标签
    // 完成态默认折叠：children 不挂载（进入对话流的是卡片头，非内部产出正文）
    expect(screen.queryByText("子代理内部产出正文")).not.toBeInTheDocument();
  });

  it("conversation 模式：subagent_stub 兜底段渲染子代理块（名称回退 subagentType）", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: [SUBAGENT_STUB_SEG] })])}
      />,
    );
    expect(screen.getByText("🤖")).toBeInTheDocument();
    // 名称与类型标签均回退 subagentType（stub 无 primary 可回退，共 2 处）
    expect(screen.getAllByText("researcher").length).toBe(2);
    // stub 恒视为运行中 → 无 Provider 时内联展开默认挂载 children（现状语义）
    expect(screen.getByText("stub 子代理产出正文")).toBeInTheDocument();
  });

  it("conversation 模式：thinking 段与无 children 的普通 tool 段仍不渲染（渲染经济不回归）", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: [THINK_SEG, PLAIN_TOOL_SEG] })])}
      />,
    );
    expect(screen.queryByText("内部思考内容")).not.toBeInTheDocument();
    expect(screen.queryByText("plain-tool-target.txt")).not.toBeInTheDocument();
  });

  it("conversation 模式：dispatch_worker 团队分身段（带 children）不进对话视图——团队卡仍仅「全部（进度）」视图", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: [TEAM_DISPATCH_SEG] })])}
      />,
    );
    // mcp__<server>__dispatch_worker 形态被排除（本地等价 isTeamDispatchTool 判定）
    expect(screen.queryByText("分身「资料调研员」")).not.toBeInTheDocument();
    expect(screen.queryByText("🤖")).not.toBeInTheDocument(); // 未误入子代理块路径
    expect(screen.queryByText("分身归属日志正文")).not.toBeInTheDocument();
  });

  it("「全部」视图零回归：thinking/text/子代理块/团队分身块全段渲染", () => {
    render(
      <TurnTimeline
        {...renderProps(
          [
            makeTurn({
              segments: [THINK_SEG, TEXT_SEG, SUBAGENT_TOOL_SEG, TEAM_DISPATCH_SEG],
            }),
          ],
          "all",
        )}
      />,
    );
    expect(screen.getByText("💭 思考过程")).toBeInTheDocument(); // thinking 折叠头
    expect(screen.getByText("报告已生成并上传")).toBeInTheDocument(); // text 段
    expect(screen.getByText("代码审查员")).toBeInTheDocument(); // 子代理块头
    expect(screen.getByText("分身「资料调研员」")).toBeInTheDocument(); // 团队分身块头
  });
});
