// task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：共享子组件冒烟测试。
//
// 抽取等价性验证分两层：
//   1. 既有 interactive-session-panel 三套测试（panel/offline/changeid）不改一行，
//      经组装层（InteractiveSessionPanel = header + TurnTimeline + SessionInputBar）
//      全绿 = 弹窗零回归（最强等价证明）。
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
    // 与原 panel 渲染同口径：第 N 轮 · 状态 + ↑in ↓out
    expect(screen.getByText(/第 1 轮 · 已完成/)).toBeInTheDocument();
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
