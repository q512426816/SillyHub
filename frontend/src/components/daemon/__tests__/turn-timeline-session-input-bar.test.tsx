// task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：共享子组件冒烟测试。
//
// 抽取等价性验证分两层：
//   1. 既有弹窗三套测试（session-panel-dialog{,-offline,-changeid}）直测
//      SessionPanel mode="dialog"（2026-08-22-session-panel-unify：适配层已删、
//      render 入口直迁），全绿 = 弹窗零回归（最强等价证明）。
//   2. 本文件直接渲染子组件，断言「同一 props 下关键输出与原内联渲染一致」——
//      选择器/文案沿用既有 panel 测试的断言口径（气泡文本 / 状态徽章 / 思考占位 /
//      过程项折叠块标题），并验证子组件可独立 import（无弹窗上下文依赖）。
//
// 已知坑：MarkdownText 用 next/dynamic ssr:false，jsdom 同步 render 得 null，
// mock 成纯文本渲染（与既有 panel 测试一致）。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TurnTimeline, type SessionTurnView } from "../turn-timeline";
import { SessionInputBar } from "../session-input-bar";
import type { SessionPermissionRequest } from "@/lib/daemon";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "用户提问",
    output: "agent 答复",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: 10,
    outputTokens: 20,
    errorDetail: null,
    processItems: [],
    ...overrides,
  };
}

function setupTimeline(overrides: Record<string, unknown> = {}) {
  const props = {
    turns: [makeTurn()],
    viewMode: "conversation" as const,
    errorMsg: null,
    sessionStatus: "active" as const,
    pendingRequests: [],
    dialogHistory: [],
    onDialogResolved: vi.fn(),
    onResend: vi.fn(),
    onSwitchProvider: vi.fn(),
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
    ...overrides,
  };
  return render(<TurnTimeline {...(props as any)} />);
}

describe("TurnTimeline（task-13 抽取共享子组件）", () => {
  it("渲染用户气泡 / agent 答复 / 轮次状态徽章（含 token）", () => {
    setupTimeline();
    expect(screen.getByText("用户提问")).toBeInTheDocument();
    expect(screen.getByText("agent 答复")).toBeInTheDocument();
    // 与原 panel 渲染同口径：第 N 轮 · 状态 + ↑in ↓out。task-03 TurnStatusBadge
    // antd 化后状态文本进 Badge status 的 text 节点（dot+text），与「第 N 轮 ·」
    // 分属不同文本节点，按文本分别断言语义不变。
    expect(screen.getByText(/第 1 轮 ·/)).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText(/↑10/)).toBeInTheDocument();
    expect(screen.getByText(/↓20/)).toBeInTheDocument();
  });

  it("运行中无答复：对话视图显示「正在思考…」占位（原内联行为）", () => {
    setupTimeline({
      turns: [makeTurn({ output: "", status: "running" })],
    });
    expect(screen.getByText(/正在思考…/)).toBeInTheDocument();
  });

  it("viewMode=all 渲染过程项（思考折叠块 + 工具行），conversation 隐藏", () => {
    const rerender = setupTimeline({
      turns: [
        makeTurn({
          processItems: [
            { kind: "thinking", text: "先想想怎么读" },
            { kind: "tool", raw: "Read src/a.ts", status: "ok" },
          ],
        }),
      ],
    });
    // 对话视图：过程项不渲染
    expect(screen.queryByText(/Read src\/a\.ts/)).not.toBeInTheDocument();
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();

    // 切全部：与原 panel 测试同口径断言（工具 raw + 思考折叠标题）
    rerender.rerender(
      <TurnTimeline
        turns={[
          makeTurn({
            processItems: [
              { kind: "thinking", text: "先想想怎么读" },
              { kind: "tool", raw: "Read src/a.ts", status: "ok" },
            ],
          }),
        ]}
        viewMode="all"
        errorMsg={null}
        sessionStatus="active"
        pendingRequests={[]}
        dialogHistory={[]}
        onDialogResolved={vi.fn()}
        onResend={vi.fn()}
        onSwitchProvider={vi.fn()}
        hasOnlineProvider
        emptyProviderLabel="Claude Code"
      />,
    );
    expect(screen.getByText(/Read src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText("思考过程")).toBeInTheDocument();
    expect(screen.getByText(/先想想怎么读/)).toBeInTheDocument();
  });

  it("errorMsg 横幅渲染", () => {
    setupTimeline({ errorMsg: "创建会话失败" });
    expect(screen.getByText(/创建会话失败/)).toBeInTheDocument();
  });

  it("无 turn 空态：在线显示 provider 已就绪两态（原内联行为）", () => {
    setupTimeline({ turns: [] });
    expect(screen.getByText(/Claude Code 已就绪/)).toBeInTheDocument();
    expect(screen.getByText(/首条消息将创建会话/)).toBeInTheDocument();

    setupTimeline({ turns: [], hasOnlineProvider: false });
    expect(screen.getByText(/没有在线守护进程/)).toBeInTheDocument();
  });

  it("pending 待答卡：active 渲染、ended 不渲染（ql-20260623 改动三门控）", () => {
    const req = {
      session_id: "sess-1",
      run_id: "run-1",
      request_id: "req-1",
      tool_name: "AskUserQuestion",
      input: {},
      dialog_kind: "ask_user",
      dialog_payload: {
        questions: [{ question: "选择哪个？", options: [{ label: "A" }] }],
      },
    } as unknown as SessionPermissionRequest;
    const { rerender } = setupTimeline({ pendingRequests: [req] });
    expect(screen.getByText(/选择哪个？/)).toBeInTheDocument();

    rerender(
      <TurnTimeline
        turns={[makeTurn()]}
        viewMode="conversation"
        errorMsg={null}
        sessionStatus="ended"
        pendingRequests={[req]}
        dialogHistory={[]}
        onDialogResolved={vi.fn()}
        onResend={vi.fn()}
        onSwitchProvider={vi.fn()}
        hasOnlineProvider
        emptyProviderLabel="Claude Code"
      />,
    );
    expect(screen.queryByText(/选择哪个？/)).not.toBeInTheDocument();
  });

  it("AskUser 提问历史按 run_id 穿插到对应 turn（对话视图 ❓ 记录）", () => {
    setupTimeline({
      dialogHistory: [
        {
          id: "d1",
          session_id: "sess-1",
          run_id: "run-1",
          request_id: "req-1",
          tool_name: "AskUserQuestion",
          dialog_kind: "AskUserQuestion",
          dialog_payload: { questions: [{ question: "文件建在哪里？" }] },
          status: "answered",
          answer: { answers: [{ answer: "用户桌面" }] },
          created_at: "t",
          answered_at: "t",
        },
      ],
    });
    expect(screen.getByText(/文件建在哪里？/)).toBeInTheDocument();
    expect(screen.getByText(/用户桌面/)).toBeInTheDocument();
  });

  it("failed turn 带 errorDetail → 渲染重新发送入口（onResend 透传）", () => {
    const onResend = vi.fn();
    setupTimeline({
      onResend,
      turns: [
        makeTurn({
          status: "failed",
          errorDetail: {
            type: "timeout",
            code: null,
            message: "上游超时",
            retryable: true,
            hint: null,
            raw: null,
          },
        }),
      ],
    });
    expect(screen.getByText(/运行失败/)).toBeInTheDocument();
    expect(screen.getByText(/上游超时/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重新发送/ }));
    expect(onResend).toHaveBeenCalledWith("用户提问");
  });
});

describe("TurnTimeline v2 段模型渲染（task-06 / 2026-08-19-session-stream-ux）", () => {
  /** 构造 tool 段（默认 Read/src/a.ts 已完成，overrides 覆盖 running/子代理等场景）。 */
  function makeToolSegment(
    id: string,
    startedAt: number,
    overrides: Partial<Extract<TurnSegment, { kind: "tool" }>> = {},
  ): TurnSegment {
    return {
      kind: "tool",
      id,
      raw: JSON.stringify({
        tool: "Read",
        args: { file_path: "src/a.ts" },
        tool_use_id: id,
        success: true,
      }),
      status: "ok",
      toolName: "Read",
      primary: "src/a.ts",
      startedAt,
      endedAt: startedAt + 500,
      children: [],
      subagentType: null,
      ...overrides,
    };
  }

  it("segments 分段渲染：all（进度）显完整段线，conversation 只显文本段（FR-01）", () => {
    const segments: TurnSegment[] = [
      { kind: "text", id: "text:main:m1:1", text: "第一段答复", streaming: false, startedAt: 1_000 },
      { kind: "thinking", id: "thinking:t1", text: "思考一下", streaming: false, ts: 2_000 },
      makeToolSegment("tool:call_1", 3_000),
      { kind: "text", id: "text:main:m1:2", text: "第二段答复", streaming: true, startedAt: 4_000 },
    ];
    const turn = makeTurn({ segments, status: "completed", output: "第一段答复第二段答复" });

    // all（进度语义）：完整段时间线（两段文本独立成段 + 思考折叠行 + 工具行）
    const { unmount } = setupTimeline({ turns: [turn], viewMode: "all" });
    expect(screen.getByText("第一段答复")).toBeInTheDocument();
    expect(screen.getByText("第二段答复")).toBeInTheDocument();
    expect(screen.getByText(/💭 思考过程/)).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    // 流式光标（streaming text 段）
    expect(document.querySelector(".seg-caret")).not.toBeNull();
    unmount();

    // conversation：只渲染 text 段，过程段（思考/工具）不挂载
    setupTimeline({ turns: [turn], viewMode: "conversation" });
    expect(screen.getByText("第一段答复")).toBeInTheDocument();
    expect(screen.getByText("第二段答复")).toBeInTheDocument();
    expect(screen.queryByText(/💭 思考过程/)).not.toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    // 终态轮不渲染状态条 / 思考占位
    expect(screen.queryByText("执行中")).not.toBeInTheDocument();
    expect(screen.queryByText(/正在思考…/)).not.toBeInTheDocument();
  });

  it("运行中轮显示状态条与思考占位，turn 终态后消失（FR-02）", () => {
    const runningSegments: TurnSegment[] = [
      makeToolSegment("tool:call_9", 1_000, {
        raw: JSON.stringify({ tool: "Bash", args: { command: "npm test" }, tool_use_id: "call_9" }),
        status: "running",
        toolName: "Bash",
        primary: "npm test",
        endedAt: null,
      }),
    ];
    const { rerender } = setupTimeline({
      turns: [
        makeTurn({
          segments: runningSegments,
          status: "running",
          turnStartedAt: Date.now() - 2_000,
          output: "",
        }),
      ],
      viewMode: "conversation",
    });
    // 状态条：运行态标签 + 工具计数（对话视图也显示，FR-02）。计数是嵌套 span
    // （工具 <b>1</b>），getByText 只匹配直接文本节点——从状态条容器断言 textContent。
    const bar = screen.getByText("执行中").parentElement;
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toMatch(/工具\s*1/);
    // 运行中且尚无 text 段 → 思考占位（原三点占位行为平移）
    expect(screen.getByText(/正在思考…/)).toBeInTheDocument();

    // turn 终态：状态条与占位消失
    rerender(
      <TurnTimeline
        turns={[
          makeTurn({
            segments: runningSegments,
            status: "completed",
            turnStartedAt: 1_000,
            output: "",
          }),
        ]}
        viewMode="conversation"
        errorMsg={null}
        sessionStatus="active"
        pendingRequests={[]}
        dialogHistory={[]}
        onDialogResolved={vi.fn()}
        onResend={vi.fn()}
        onSwitchProvider={vi.fn()}
        hasOnlineProvider
        emptyProviderLabel="Claude Code"
      />,
    );
    expect(screen.queryByText("执行中")).not.toBeInTheDocument();
    expect(screen.queryByText(/正在思考…/)).not.toBeInTheDocument();
  });

  it("all 视图 AskUser 提问按时间戳穿插在段线对应位置（merged 排序平移）", () => {
    const segments: TurnSegment[] = [
      { kind: "text", id: "text:main:m1:1", text: "穿插前文本", streaming: false, startedAt: 1_000 },
      makeToolSegment("tool:call_2", 5_000, {
        raw: JSON.stringify({ tool: "Grep", args: { pattern: "foo" }, tool_use_id: "call_2" }),
        toolName: "Grep",
        primary: "foo",
      }),
    ];
    setupTimeline({
      turns: [makeTurn({ segments, status: "completed", output: "穿插前文本" })],
      viewMode: "all",
      dialogHistory: [
        {
          id: "d9",
          session_id: "sess-1",
          run_id: "run-1",
          request_id: "req-9",
          tool_name: "AskUserQuestion",
          dialog_kind: "AskUserQuestion",
          dialog_payload: { questions: [{ question: "穿插问题？", options: [{ label: "是" }] }] },
          status: "answered",
          answer: { answers: [{ answer: "是" }] },
          // ts=3000：落在 text 段（1000）与工具段（5000）之间
          created_at: new Date(3_000).toISOString(),
          answered_at: new Date(3_500).toISOString(),
        },
      ],
    });
    // AskUser 以工具卡片形态出现在段线中
    expect(screen.getByText("AskUserQuestion")).toBeInTheDocument();
    expect(screen.getByText(/穿插问题？/)).toBeInTheDocument();
    // 按 ts 穿插：text 段 → AskUser 卡 → 工具段（文档顺序）
    const textEl = screen.getByText("穿插前文本");
    const askEl = screen.getByText("AskUserQuestion");
    const toolEl = screen.getByText("Grep");
    expect(textEl.compareDocumentPosition(askEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(askEl.compareDocumentPosition(toolEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("SessionInputBar（task-13 抽取共享子组件）", () => {
  function setupBar(overrides: Record<string, unknown> = {}) {
    const props = {
      value: "",
      onChange: vi.fn(),
      onSend: vi.fn(),
      disabled: false,
      placeholder: "输入首条消息创建会话",
      creating: false,
      ...overrides,
    };
    return { props, ...render(<SessionInputBar {...(props as any)} />) };
  }

  it("受控输入 + placeholder + 变化回调", () => {
    const { props } = setupBar({ value: "hello" });
    const input = screen.getByPlaceholderText(
      "输入首条消息创建会话",
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("hello");
    expect(props.onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "hello2" } });
    expect(props.onChange).toHaveBeenCalledWith("hello2");
  });

  it("Enter 发送 / Shift+Enter 换行不发送（原内联行为）", () => {
    const { props } = setupBar({ value: "hi" });
    const input = screen.getByPlaceholderText("输入首条消息创建会话");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it("disabled 禁用输入框与发送按钮；空输入禁用发送（原内联行为）", () => {
    const first = setupBar({ disabled: true, value: "hi" });
    const input = screen.getByPlaceholderText("输入首条消息创建会话") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect((screen.getByTitle("发送") as HTMLButtonElement).disabled).toBe(true);
    first.unmount();

    // enabled 但空输入：发送按钮仍禁用（!value.trim()）
    setupBar({ disabled: false, value: "   " });
    expect((screen.getByTitle("发送") as HTMLButtonElement).disabled).toBe(true);
  });
});
