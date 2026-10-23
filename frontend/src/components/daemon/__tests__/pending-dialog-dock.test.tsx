// 2026-10-22-askuser-dock-inputbar：PendingDialogDock（会话底部输入框位置的
// pending AskUser 待答 dock）测试。自 turn-timeline-dialog-minimize.test.tsx
// 迁移改写——待答卡由 TurnTimeline 时间线内渲染迁至输入框位置互斥替换
// SessionInputBar（用户裁决：问答优先，答完自动恢复），最小化/胶囊/还原交互
// 原样保留。
//
// 覆盖：
//   1. 默认展开：卡头有最小化按钮、无胶囊；dock 容器固定最大高度 + 区内滚动
//      （max-h-[45vh] overflow-y-auto overscroll-contain，FR-02）；
//   2. 最小化：卡片渲染 null（组件级 minimized 契约）、胶囊出现 + 角标 1；
//   3. 还原保留已填内容：选项 + 手动输入在最小化/还原后原样恢复；
//   4. 多卡累计：角标 2、展开明细列表定点还原指定卡 → 角标 1；
//   5. 父级移除卡（提交 / permission_resolved 后 pendingRequests 过滤）→
//      胶囊计数同步清（prune effect），清空后胶囊消失；
//   6. ended/failed 会话：dock 整体不渲染（卡区与胶囊都无）；
//   7. focusRequest（待决策 pill 定位）：无条件还原 + 卡区 ring 闪烁（FR-03，
//      不再滚顶——卡区不在时间线滚动区）。
//
// mock 口径：MarkdownText（next/dynamic jsdom 同步 render 得 null，照抄
// turn-timeline-dialog-minimize 先例）；@/lib/daemon 的 respondSessionPermission
// （提交路径，本文件只验证交互，mock 兜底防真实请求）。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PendingDialogDock } from "../pending-dialog-dock";
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

function setupDock(overrides: Record<string, unknown> = {}) {
  const props = {
    pendingRequests: [makeDialogRequest()],
    sessionStatus: "active" as const,
    onResolved: vi.fn(),
    ...overrides,
  };
  return render(<PendingDialogDock {...(props as any)} />);
}

/** dock 卡列容器（max-h 内滚区，data-testid 锚点）。 */
function dockListBox() {
  const el = document.querySelector('[data-testid="pending-dialog-dock"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("PendingDialogDock（输入框位置待答 dock，2026-10-22-askuser-dock-inputbar）", () => {
  it("默认展开：卡头有最小化按钮，无胶囊；容器固定最大高度 + 区内滚动", () => {
    setupDock();
    expect(screen.getByText("第一个问题")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "最小化提问卡片" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
    // FR-02：固定最大高度（45vh）+ 区内上下滚动 + 防滚动穿透（用户裁决：
    // 占比高度固定一个适合的最大高度，超出显示滚动条）。
    const box = dockListBox();
    expect(box.className).toContain("max-h-[45vh]");
    expect(box.className).toContain("overflow-y-auto");
    expect(box.className).toContain("overscroll-contain");
  });

  it("最小化：卡片消失、胶囊出现角标 1", () => {
    setupDock();
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
  });

  it("还原保留已填内容：选项 + 手动输入原样恢复", () => {
    setupDock();
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
    setupDock({
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
    const { rerender } = setupDock({
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
      <PendingDialogDock
        {...({
          pendingRequests: [
            makeDialogRequest({
              request_id: "req-2",
              dialog_payload: singleQuestionPayload("第二个问题"),
            }),
          ],
          sessionStatus: "active",
          onResolved: vi.fn(),
        } as any)}
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByTitle("点击还原该卡片（最近一条）")).toHaveTextContent(
      "第二个问题",
    );

    // 全部移除 → dock 整体消失（输入框由挂载点恢复）
    rerender(
      <PendingDialogDock
        {...({
          pendingRequests: [],
          sessionStatus: "active",
          onResolved: vi.fn(),
        } as any)}
      />,
    );
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="pending-dialog-dock"]')).toBeNull();
  });

  it("ended 会话：dock 整体不渲染（卡区与胶囊都无，输入框由挂载点正常显示）", () => {
    const { rerender } = setupDock();
    expect(dockListBox()).toBeInTheDocument();

    rerender(
      <PendingDialogDock
        {...({
          pendingRequests: [makeDialogRequest()],
          sessionStatus: "ended",
          onResolved: vi.fn(),
        } as any)}
      />,
    );
    expect(document.querySelector('[data-testid="pending-dialog-dock"]')).toBeNull();
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
  });

  it("focusRequest（待决策 pill 定位）：无条件还原 + 卡区 ring 闪烁，不滚顶", () => {
    const { rerender } = setupDock();
    fireEvent.click(screen.getByRole("button", { name: "最小化提问卡片" }));
    expect(
      screen.queryByRole("button", { name: /提交回答/ }),
    ).not.toBeInTheDocument();

    // pill 点击 → focusRequest nonce 递增：还原 + ring 闪烁（dock 不持滚动容器，
    // 原「滚顶」步骤随迁移移除——FR-03）。
    rerender(
      <PendingDialogDock
        {...({
          pendingRequests: [makeDialogRequest()],
          sessionStatus: "active",
          onResolved: vi.fn(),
          focusRequest: { requestId: "req-1", nonce: 1 },
        } as any)}
      />,
    );
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).toBeInTheDocument();
    expect(dockListBox().className).toContain("ring-2");
    expect(dockListBox().className).toContain("ring-brand-500");
  });
});
