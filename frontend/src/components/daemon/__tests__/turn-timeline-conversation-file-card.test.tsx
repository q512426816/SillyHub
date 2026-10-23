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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

// 2026-10-23-turn-file-diff-dialog：文件行点击弹窗的取数 mock（零真网）。
const getAgentSessionLogsMock = vi.fn();
vi.mock("@/lib/daemon/sessions", () => ({
  getAgentSessionLogs: (...args: unknown[]) => getAgentSessionLogsMock(...args),
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
    dialogHistory: [],
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
  getAgentSessionLogsMock.mockReset();
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
    expect(screen.getByText("思考")).toBeInTheDocument(); // D-025 语义标签

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
    expect(screen.getByText("思考")).toBeInTheDocument(); // thinking 折叠头（D-025 语义标签）
    expect(screen.getByText("报告已生成并上传")).toBeInTheDocument(); // text 段
    expect(screen.getByText("代码审查员")).toBeInTheDocument(); // 子代理块头
    expect(screen.getByText("分身「资料调研员」")).toBeInTheDocument(); // 团队分身块头
  });
});

/* task-11（2026-10-20-session-page-dsh-alignment / FR-14 / FR-16 / D-023@v1）：
 * 轮级文件变更卡的挂载面——轮尾状态行之后挂卡；无快照不占位。
 * 2026-10-22-file-card-hide-empty：tool_only / 采集失败也不再出「仅工具编辑」卡，
 * 整轮零渲染；会话级汇总挂会话流顶部且受 props 开关控制。
 * 数据全部来自 SessionTurnView.fileChanges / fileChangesCapability（挂载方从
 * /runs 读模型透传），TurnTimeline 自身零取数。 */
describe("轮级文件变更卡与会话级汇总挂载（task-11 / 线 C 1b）", () => {
  function makeSnapshot(
    overrides: Partial<NonNullable<SessionTurnView["fileChanges"]>> = {},
  ): NonNullable<SessionTurnView["fileChanges"]> {
    return {
      runId: "run-1",
      baselineHead: "abc1234",
      collectedAt: "2026-10-21T08:00:00Z",
      collectMs: 30,
      status: "ok",
      files: [],
      concurrentSessionsHint: true,
      ...overrides,
    };
  }

  it("有快照：轮尾状态行之后挂出逐文件卡（折叠态「N 个文件变更」+ 共享工作区提示）", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({
            fileChanges: makeSnapshot({
              files: [
                {
                  path: "src/app.tsx",
                  status: "modified",
                  added: 12,
                  deleted: 3,
                  attribution: "edit_patch",
                  editToolNames: ["Edit"],
                },
                {
                  path: "package.json",
                  status: "modified",
                  added: 0,
                  deleted: 1,
                  attribution: "command",
                },
              ],
            }),
            fileChangesCapability: "full",
          }),
        ])}
      />,
    );

    const card = screen.getByTestId("turn-file-changes");
    expect(screen.getByText("总共 2 个文件变更")).toBeInTheDocument();
    expect(card).toBeInTheDocument();
    // 挂在轮尾状态行（RoundDivider「第 N 轮」）之后，不是轮首；卡片头也带「第 N 轮」，
    // 取 DOM 序第一个（分隔行在前）。
    const [divider] = screen.getAllByText("第 1 轮");
    expect(
      divider!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 折叠态即显共享工作区提示（concurrentSessionsHint=true）。汇总卡也有一份同款
    // 横幅（R-08 恒标），这里限定在本轮卡片内断言。
    expect(within(card).getByText("共享工作区，可能含并行会话改动")).toBeInTheDocument();
  });

  it('capability="tool_only"（无快照）：整轮不出卡，全树无「仅工具编辑」也无「无改动」', () => {
    // 2026-10-22-file-card-hide-empty（用户裁决「没有信息就隐藏卡片」）：历史轮
    // （daemon 0.2.0 / 部署之前）不再挂零信息降级卡。
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({ fileChanges: null, fileChangesCapability: "tool_only" }),
        ])}
      />,
    );

    expect(screen.queryByTestId("turn-file-changes")).toBeNull();
    expect(screen.queryByTestId("file-changes-card")).toBeNull();
    expect(screen.queryByText("仅工具编辑")).toBeNull();
    expect(screen.queryByText(/daemon 未上报工作区快照/)).toBeNull();
    expect(screen.queryByText(/无改动/)).toBeNull();
  });

  it("status=unavailable（采集失败）：同样不出卡、不出占位", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({
            fileChanges: makeSnapshot({ status: "unavailable", reason: "not_a_repo", files: [] }),
            fileChangesCapability: "full",
          }),
        ])}
      />,
    );

    expect(screen.queryByTestId("turn-file-changes")).toBeNull();
    expect(screen.queryByText("仅工具编辑")).toBeNull();
    expect(screen.queryByText(/无改动/)).toBeNull();
  });

  it("无 fileChanges / capability 字段（旧消费方未接线）：不出卡、不出任何占位", () => {
    render(<TurnTimeline {...renderProps([makeTurn({ output: "答复正文" })])} />);

    expect(screen.queryByTestId("turn-file-changes")).toBeNull();
    expect(screen.queryByTestId("file-changes-card")).toBeNull();
    expect(screen.queryByTestId("file-changes-summary")).toBeNull();
    expect(screen.getByText("答复正文")).toBeInTheDocument();
  });

  it("status=partial：卡片照出 + 「（部分）」（超时/截断不是错误态）", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({
            fileChanges: makeSnapshot({
              status: "partial",
              reason: "timeout",
              files: [
                {
                  path: "src/app.tsx",
                  status: "modified",
                  added: 4,
                  deleted: 0,
                  attribution: "edit_patch",
                },
              ],
            }),
            fileChangesCapability: "full",
          }),
        ])}
      />,
    );

    expect(screen.getByText("总共 1 个文件变更")).toBeInTheDocument();
    expect(screen.getByText("（部分）")).toBeInTheDocument();
  });

  it("会话级汇总：挂会话流顶部（首轮之前），同一 path 跨轮去重", () => {
    const { container } = render(
      <TurnTimeline
        {...renderProps([
          makeTurn({
            turn: 1,
            fileChanges: makeSnapshot({
              files: [
                {
                  path: "src/shared.ts",
                  status: "modified",
                  added: 10,
                  deleted: 1,
                  attribution: "edit_patch",
                },
              ],
            }),
            fileChangesCapability: "full",
          }),
          makeTurn({
            runId: "run-2",
            turn: 2,
            fileChanges: makeSnapshot({
              files: [
                {
                  path: "src/shared.ts",
                  status: "modified",
                  added: 5,
                  deleted: 2,
                  attribution: "edit_patch",
                },
              ],
            }),
            fileChangesCapability: "full",
          }),
        ])}
      />,
    );

    const summary = screen.getByTestId("file-changes-summary");
    expect(summary).toHaveAttribute("data-total-files", "1");
    expect(screen.getByText("共 1 个文件")).toBeInTheDocument();
    expect(screen.getByText("+15")).toBeInTheDocument();
    // 会话流顶部 = 第一轮之前（DOM 序）。
    const firstTurn = container.querySelector('[data-testid="turn-block"]');
    expect(firstTurn).not.toBeNull();
    expect(
      summary.compareDocumentPosition(firstTurn!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fileChangesSummary={false} 关闭会话级汇总（轮级卡仍在）", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({
            fileChanges: makeSnapshot({
              files: [
                {
                  path: "src/app.tsx",
                  status: "modified",
                  added: 2,
                  deleted: 0,
                  attribution: "edit_patch",
                },
              ],
            }),
            fileChangesCapability: "full",
          }),
        ])}
        fileChangesSummary={false}
      />,
    );

    expect(screen.queryByTestId("file-changes-summary")).toBeNull();
    expect(screen.getByTestId("turn-file-changes")).toBeInTheDocument();
  });
});

// ── 2026-10-23-turn-file-diff-dialog：文件行点击 → 本轮变更内容弹窗 ──
// 锁定契约：sessionId 接线的挂载面点击行开弹窗（FR-01）；未接线的旧消费方
// 行点击零行为、DOM 无弹窗（FR-04 零回归）。弹窗取数（logs mock）与渲染形态
// 细节由 turn-file-diff-dialog.test.tsx 专项覆盖，这里只锁接线。

describe("文件变更卡行点击 → 本轮变更弹窗（2026-10-23-turn-file-diff-dialog）", () => {
  function wiringTurn(
    overrides: Partial<SessionTurnView> = {},
  ): SessionTurnView {
    return {
      runId: "run-1",
      turn: 1,
      prompt: "改一下代码",
      output: "已完成",
      status: "completed",
      seenLogIds: new Set<string>(),
      inputTokens: null,
      outputTokens: null,
      fileChanges: {
        runId: "run-1",
        baselineHead: "abc1234",
        collectedAt: "2026-10-23T08:00:00Z",
        collectMs: 30,
        status: "ok",
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            added: 3,
            deleted: 1,
            attribution: "edit_patch",
            editToolNames: ["Edit"],
          },
          {
            path: "scripts/build.sh",
            status: "modified",
            added: 2,
            deleted: 0,
            attribution: "command",
          },
        ],
        concurrentSessionsHint: true,
      },
      fileChangesCapability: "full",
      ...overrides,
    };
  }

  it("agent 编辑归因行（改N次>0）无补丁：弹窗文案走「确实来自 agent 编辑」分支（2026-10-24-pi-edit-patch-synth FR-04 接线）", async () => {
    // 空日志 = 配不到补丁（pi 存量轮次形态）。src/app.tsx 归因 edit_patch +
    // editToolNames（→卡片改1次）→ 弹窗应显示区分文案而非「未来自编辑工具」。
    getAgentSessionLogsMock.mockResolvedValue([]);
    render(
      <TurnTimeline
        {...renderProps([wiringTurn()])}
        sessionId="sess-1"
      />,
    );

    fireEvent.click(screen.getByTestId("file-changes-header"));
    const toolRow = screen
      .getAllByTestId("file-changes-row")
      .find((row) => row.getAttribute("data-path") === "src/app.tsx");
    fireEvent.click(toolRow!);

    const dialog = await screen.findByTestId("turn-file-diff-dialog");
    const body = within(dialog).getByTestId("turn-file-diff-body").textContent!;
    expect(body).toContain("确实来自本轮 agent 的编辑工具");
    expect(body).not.toContain("未来自本轮 agent 的编辑工具");
  });

  it("sessionId 接线：点击文件行弹窗打开，展示该文件本轮 diff 内容（FR-01）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      {
        id: "c1",
        run_id: "run-1",
        timestamp: "2026-10-23T08:00:00Z",
        channel: "tool_call",
        content_redacted: JSON.stringify({
          tool: "Edit",
          args: { file_path: "src/app.tsx" },
          tool_use_id: "tu-1",
        }),
        tool_use_id: "tu-1",
      },
      {
        id: "c2",
        run_id: "run-1",
        timestamp: "2026-10-23T08:00:01Z",
        channel: "stdout",
        content_redacted: "[TOOL_RESULT] ok",
        edit_patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["-old", "+new"] }]),
        tool_use_id: "tu-1",
      },
    ]);
    render(
      <TurnTimeline
        {...renderProps([wiringTurn()])}
        sessionId="sess-1"
      />,
    );

    // 卡片默认折叠：先点头部展开，再点目标文件行（按 data-path 精确选行）。
    fireEvent.click(screen.getByTestId("file-changes-header"));
    const toolRow = screen
      .getAllByTestId("file-changes-row")
      .find((row) => row.getAttribute("data-path") === "src/app.tsx");
    fireEvent.click(toolRow!);

    const dialog = await screen.findByTestId("turn-file-diff-dialog");
    expect(within(dialog).getByText("src/app.tsx")).toBeInTheDocument();
    // diff 内容出在弹窗内（红删绿增行），且本轮日志按 runKey 单轮拉取。
    expect(await within(dialog).findByText("old")).toBeInTheDocument();
    expect(within(dialog).getByText("new")).toBeInTheDocument();
    expect(getAgentSessionLogsMock).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("shell 归因行（命令行/其他区段）点击同样开弹窗：source 上抛 → 内容区如实说明（FR-03）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    render(
      <TurnTimeline {...renderProps([wiringTurn()])} sessionId="sess-1" />,
    );

    // grouping 后 shell 行收进「命令行/其他」区段：展开头部 + 点开区段再点行。
    fireEvent.click(screen.getByTestId("file-changes-header"));
    fireEvent.click(screen.getByTestId("file-changes-other-toggle"));
    const shellRow = screen
      .getAllByTestId("file-changes-row")
      .find((row) => row.getAttribute("data-source") === "shell");
    fireEvent.click(shellRow!);

    const dialog = await screen.findByTestId("turn-file-diff-dialog");
    expect(
      await within(dialog).findByText(/未来自本轮 agent 的编辑工具/s),
    ).toBeInTheDocument();
    expect(within(dialog).queryByTestId("turn-file-diff-section")).toBeNull();
  });

  it("已删除文件行可点击并弹窗如实说明（FR-03/grouping）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    render(
      <TurnTimeline
        {...renderProps([
          wiringTurn({
            fileChanges: {
              runId: "run-1",
              baselineHead: "abc1234",
              collectedAt: "2026-10-23T08:00:00Z",
              collectMs: 30,
              status: "ok",
              files: [
                {
                  path: "legacy/old.ts",
                  status: "deleted",
                  added: 0,
                  deleted: 9,
                  attribution: "command",
                },
              ],
              concurrentSessionsHint: true,
            },
          }),
        ])}
        sessionId="sess-1"
      />,
    );

    fireEvent.click(screen.getByTestId("file-changes-header"));
    fireEvent.click(screen.getByTestId("file-changes-other-toggle"));
    const deletedRow = screen
      .getAllByTestId("file-changes-row")
      .find((row) => row.getAttribute("data-status") === "deleted");
    expect(deletedRow).not.toBeNull();
    fireEvent.click(deletedRow!);

    const dialog = await screen.findByTestId("turn-file-diff-dialog");
    expect(await within(dialog).findByText(/本轮被删除/s)).toBeInTheDocument();
    expect(within(dialog).queryByTestId("turn-file-diff-section")).toBeNull();
  });

  it("未接 sessionId（旧消费方）：行点击零行为、全树无弹窗（FR-04 零回归）", () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    render(<TurnTimeline {...renderProps([wiringTurn()])} />);

    fireEvent.click(screen.getByTestId("file-changes-header"));
    const anyRow = screen
      .getAllByTestId("file-changes-row")
      .find((row) => row.getAttribute("data-path") === "src/app.tsx");
    fireEvent.click(anyRow!);

    expect(screen.queryByTestId("turn-file-diff-dialog")).toBeNull();
    expect(getAgentSessionLogsMock).not.toHaveBeenCalled();
  });
});
