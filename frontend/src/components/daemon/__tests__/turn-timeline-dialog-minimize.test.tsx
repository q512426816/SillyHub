// ql-20260825-006：会话页 pending 提问卡（TurnTimeline 内 AskUserDialogCard）
// 最小化能力测试。用户反馈「会话页面 AskUserQuestion 弹窗没有最小化按钮」——
// task-08 只给 approvals 聚合页（SessionPermissionPanel）接了最小化，会话页
// TurnTimeline 渲染提问卡时未传 onMinimize/minimized（卡组件缺省不渲染按钮）。
//
// 覆盖：
//   1. 默认展开：卡头有最小化按钮、无胶囊（改动后新增能力，不传则无按钮的
//      向后兼容由 ask-user-dialog-card 组件级测试覆盖）；
//   2. 最小化：卡片渲染 null（组件级 minimized 契约）、胶囊出现 + 角标 1、
//      全部最小化时 sticky 视觉框消失（容器仅作挂载占位保 state）；
//   3. 还原保留已填内容：选项 + 手动输入在最小化/还原后原样恢复；
//   4. 多卡累计：角标 2、展开明细列表定点还原指定卡 → 角标 1；
//   5. 父级移除卡（提交 / permission_resolved 后 pendingRequests 过滤）→
//      胶囊计数同步清（prune effect），清空后胶囊消失；
//   6. ended 会话不回显 pending 卡（既有门控）→ 胶囊同样不渲染。
//
// mock 口径：MarkdownText（next/dynamic jsdom 同步 render 得 null，照抄
// turn-timeline-session-input-bar.test）；@/lib/daemon 的
// respondSessionPermission（提交路径，本文件只验证最小化交互，mock 兜底防真实请求）。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionPermissionRequest } from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

vi.mock("@/lib/daemon", () => ({
  respondSessionPermission: vi.fn(() => Promise.resolve()),
}));

function singleQuestionPayload(question: string) {
  return {
    questions: [
      { question, options: [{ label: "选项 A" }, { label: "选项 B" }] },
    ],
  };
}

function makeDialogRequest(
  overrides: Partial<SessionPermissionRequest> = {},
): SessionPermissionRequest {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-1",
    tool_name: "AskUserQuestion",
    input: {},
    dialog_kind: "ask_user",
    dialog_payload: singleQuestionPayload("第一个问题"),
    ...overrides,
  };
}

function setupTimeline(overrides: Record<string, unknown> = {}) {
  const props = {
    turns: [],
    viewMode: "conversation" as const,
    errorMsg: null,
    sessionStatus: "active" as const,
    pendingRequests: [makeDialogRequest()],
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

describe("TurnTimeline pending 提问卡最小化（ql-20260825-006）", () => {
  it("默认展开：卡头有最小化按钮，无胶囊", () => {
    setupTimeline();
    expect(screen.getByText("第一个问题")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "最小化提问卡片" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
  });

  it("最小化：卡片消失、胶囊出现角标 1、sticky 视觉框移除", () => {
    setupTimeline();
    fireEvent.click(screen.getByRole("button", { name: "最小化提问卡片" }));

    // 卡片渲染 null：提交按钮与最小化按钮都移出 DOM
    expect(
      screen.queryByRole("button", { name: /提交回答/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "最小化提问卡片" }),
    ).not.toBeInTheDocument();
    // 胶囊出现 + 角标 1
    expect(
      screen.getByRole("group", { name: "最小化的待决策卡片" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    // 全部最小化：sticky 容器仅作挂载占位（无 indigo 视觉类）
    const stickyBox = document.querySelector('[data-testid="turn-timeline-scroll"] > div');
    expect(stickyBox).not.toBeNull();
    expect(stickyBox!.className).not.toContain("bg-indigo-50");
  });

  it("还原保留已填内容：选项 + 手动输入原样恢复", () => {
    setupTimeline();
    // 先作答：点选项 A + 填手动输入
    fireEvent.click(screen.getByText("选项 A"));
    const input = screen.getByPlaceholderText("或手动输入（填写后以此内容作答）");
    fireEvent.change(input, { target: { value: "补充说明" } });

    fireEvent.click(screen.getByRole("button", { name: "最小化提问卡片" }));
    expect(
      screen.queryByRole("button", { name: /提交回答/ }),
    ).not.toBeInTheDocument();

    // 点胶囊主体还原最近一条
    fireEvent.click(screen.getByTitle("点击还原该卡片（最近一条）"));
    const submit = screen.getByRole("button", { name: /提交回答/ });
    expect(submit).not.toBeDisabled();
    expect(
      screen.getByPlaceholderText("或手动输入（填写后以此内容作答）"),
    ).toHaveValue("补充说明");
    // 胶囊随最小化集合清空而消失
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
  });

  it("多卡累计：两卡最小化角标 2，明细列表定点还原 → 角标 1", () => {
    setupTimeline({
      pendingRequests: [
        makeDialogRequest({
          request_id: "req-1",
          dialog_payload: singleQuestionPayload("第一个问题"),
        }),
        makeDialogRequest({
          request_id: "req-2",
          dialog_payload: singleQuestionPayload("第二个问题"),
        }),
      ],
    });
    const minimizeBtns = screen.getAllByRole("button", {
      name: "最小化提问卡片",
    });
    expect(minimizeBtns).toHaveLength(2);
    for (const btn of minimizeBtns) fireEvent.click(btn);

    expect(screen.getByText("2")).toBeInTheDocument();
    // 展开明细 → 定点还原 req-1（第一个问题）
    fireEvent.click(screen.getByRole("button", { name: "展开最小化列表" }));
    fireEvent.click(screen.getByRole("button", { name: "还原 第一个问题" }));

    expect(screen.getByText("1")).toBeInTheDocument();
    // req-1 回到列表（提交按钮可见），req-2 仍最小化
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("点击还原该卡片（最近一条）")).toHaveTextContent(
      "第二个问题",
    );
  });

  it("父级移除卡（pendingRequests 过滤）→ 胶囊计数同步清直至消失", () => {
    const { rerender } = setupTimeline({
      pendingRequests: [
        makeDialogRequest({
          request_id: "req-1",
          dialog_payload: singleQuestionPayload("第一个问题"),
        }),
        makeDialogRequest({
          request_id: "req-2",
          dialog_payload: singleQuestionPayload("第二个问题"),
        }),
      ],
    });
    for (const btn of screen.getAllByRole("button", {
      name: "最小化提问卡片",
    }))
      fireEvent.click(btn);
    expect(screen.getByText("2")).toBeInTheDocument();

    // 模拟 req-1 提交 / permission_resolved：父级从 pendingRequests 移除
    rerender(
      <TurnTimeline
        {...({
          turns: [],
          viewMode: "conversation",
          errorMsg: null,
          sessionStatus: "active",
          pendingRequests: [
            makeDialogRequest({
              request_id: "req-2",
              dialog_payload: singleQuestionPayload("第二个问题"),
            }),
          ],
          dialogHistory: [],
          onDialogResolved: vi.fn(),
          onResend: vi.fn(),
          onSwitchProvider: vi.fn(),
          hasOnlineProvider: true,
          emptyProviderLabel: "Claude Code",
        } as any)}
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByTitle("点击还原该卡片（最近一条）")).toHaveTextContent(
      "第二个问题",
    );

    // 全部移除 → 胶囊整体消失
    rerender(
      <TurnTimeline
        {...({
          turns: [],
          viewMode: "conversation",
          errorMsg: null,
          sessionStatus: "active",
          pendingRequests: [],
          dialogHistory: [],
          onDialogResolved: vi.fn(),
          onResend: vi.fn(),
          onSwitchProvider: vi.fn(),
          hasOnlineProvider: true,
          emptyProviderLabel: "Claude Code",
        } as any)}
      />,
    );
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
  });

  it("ended 会话：不回显 pending 卡，也不渲染胶囊（既有门控延伸）", () => {
    setupTimeline({ sessionStatus: "ended" });
    expect(
      screen.queryByRole("button", { name: "最小化提问卡片" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
  });
});
