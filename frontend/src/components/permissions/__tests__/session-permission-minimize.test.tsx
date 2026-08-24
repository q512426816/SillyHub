/**
 * task-08（FR-04 / D-003@v1，change 2026-08-24-platform-session-feedback-fix）：
 * SessionPermissionPanel 最小化胶囊 + 卡组件 minimized props 测试。
 *
 * 覆盖：
 *   1. 默认展开零变化：无胶囊、卡头最小化按钮可选（constraints：默认态与现状一致）；
 *   2. 最小化：卡片 hidden 移出可访问树（role 查询为 null；text 查询不受
 *      display:none 影响，须用 role）、胶囊 group 出现、角标计数；
 *   3. 还原保留已填内容：选项 + 手动输入在最小化/还原后原样恢复
 *      （wrapper 只切 hidden，卡组件不重挂载 → state 保留）；
 *   4. 多卡累计：角标累计、胶囊标题 = 最近一条 request 的问题文本；
 *   5. 展开列表定点还原指定卡片；
 *   6. permission_resolved 同步清最小化集合：角标递减、全 resolved 后胶囊消失
 *      （acceptance：无论展开还是最小化都能正确移除）；
 *   7/8. AskUserDialogCard / PermissionApprovalCard 组件级 minimized/onMinimize
 *      契约（不传 onMinimize 向后兼容、minimized=true 渲染 null、还原保留）。
 *
 * SSE mock 体系照抄 session-permission-panel.test.tsx（task-12 fetch-sse：
 * fetch + ReadableStream，往流里写 ``data: {...}\n\n`` 原始帧触发 SSE 路径）。
 */

import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { PermissionApprovalCard } from "@/components/permission-approval-card";
import { SessionPermissionPanel } from "@/components/permissions/session-permission-panel";
import type { SessionPermissionRequest } from "@/lib/daemon";

// ── next/link mock（DialogContextBar 用 Link）──
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── useSession mock（panel 读 accessToken，selector 形态）──
vi.mock("@/stores/session", () => ({
  useSession: (selector: (s: { accessToken: string }) => string) =>
    selector({ accessToken: "test-token" }),
}));

// ── getApiBaseUrl mock（SSE URL 构造；ApiError 供卡组件错误分支引用）──
vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "http://localhost",
  ApiError: class ApiError extends Error {},
}));

// ── fetch mock（fetch-sse）：每次 SSE fetch 返回可写流，测试往里推帧 ──

interface MockSseStream {
  url: string;
  init: RequestInit;
  push: (text: string) => void;
}

const instances: MockSseStream[] = [];

function installSseFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, init?: RequestInit) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const encoder = new TextEncoder();
      const inst: MockSseStream = {
        url: typeof input === "string" ? input : input.toString(),
        init: (init ?? {}) as RequestInit,
        push: (text) => controller.enqueue(encoder.encode(text)),
      };
      instances.push(inst);
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    },
  );
}

/** 推一条默认 data 帧 + 冲刷 fetch-sse reader 微任务循环。 */
async function dispatchMessage(inst: MockSseStream, data: unknown) {
  inst.push(`data: ${JSON.stringify(data)}\n\n`);
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

/** 冲刷 render 后的微任务，等 fetch-sse 的 async IIFE 走到 fetch 调用。 */
async function flushSse() {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
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
    dialog_payload: {
      questions: [
        {
          question: "前端框架是？",
          header: "框架",
          options: [{ label: "Next.js" }, { label: "Vue" }],
        },
      ],
    },
    ...overrides,
  };
}

/** 单问题 payload（问题文本参数化，多卡用例各推一条）。 */
function singleQuestionPayload(question: string) {
  return {
    questions: [
      { question, options: [{ label: "选项 A" }, { label: "选项 B" }] },
    ],
  };
}

describe("SessionPermissionPanel 最小化胶囊（task-08 FR-04）", () => {
  beforeEach(() => {
    instances.length = 0;
    installSseFetchMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    instances.length = 0;
  });

  it("默认展开零变化：无胶囊，卡头有最小化按钮", async () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    await flushSse();
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest(),
    });
    // 无最小化卡片 → 不渲染胶囊
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
    // 默认行为不变：问题卡正常渲染 + 卡头有最小化按钮
    expect(screen.getByText("前端框架是？")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "最小化提问卡片" }),
    ).toBeInTheDocument();
  });

  it("最小化：卡片移出可访问树，胶囊出现且角标为 1", async () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    await flushSse();
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest(),
    });

    fireEvent.click(screen.getByRole("button", { name: "最小化提问卡片" }));

    // 胶囊出现
    expect(
      screen.getByRole("group", { name: "最小化的待决策卡片" }),
    ).toBeInTheDocument();
    // 卡片移出可访问树（hidden → display:none，role 查询拿不到）
    expect(
      screen.queryByRole("button", { name: /提交回答/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "最小化提问卡片" }),
    ).not.toBeInTheDocument();
    // wrapper 带 hidden 属性 + data-minimized 标记（text 查询仍可见，故用 DOM 断言）
    const wrapper = document.querySelector('[data-panel-card="req-1"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute("hidden");
    expect(wrapper).toHaveAttribute("data-minimized", "true");
    // 角标 1
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("还原保留已填内容：选项 + 手动输入原样恢复，可继续提交", async () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    await flushSse();
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest(),
    });

    // 先作答：点选项 A + 填手动输入框
    fireEvent.click(screen.getByText("Next.js"));
    const input = screen.getByPlaceholderText("或手动输入（填写后以此内容作答）");
    fireEvent.change(input, { target: { value: "补充说明" } });

    // 最小化 → 点胶囊主体还原最近一条
    fireEvent.click(screen.getByRole("button", { name: "最小化提问卡片" }));
    expect(
      screen.queryByRole("button", { name: /提交回答/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("点击还原该卡片（最近一条）"));

    // 提交按钮回来且可用；输入框值保留（卡组件未重挂载）
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

  it("多卡累计：两张卡最小化 → 角标 2，胶囊标题为最近一条问题", async () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    await flushSse();
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-1",
        dialog_payload: singleQuestionPayload("第一个问题"),
      }),
    });
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-2",
        dialog_payload: singleQuestionPayload("第二个问题"),
      }),
    });

    // 两张卡都最小化
    const minimizeBtns = screen.getAllByRole("button", {
      name: "最小化提问卡片",
    });
    expect(minimizeBtns).toHaveLength(2);
    for (const btn of minimizeBtns) fireEvent.click(btn);

    // 角标 2；胶囊标题 = 最近一条（第二个问题）
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "第二个问题" }),
    ).toBeInTheDocument();
  });

  it("展开列表定点还原：还原指定卡片，角标递减", async () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    await flushSse();
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-1",
        dialog_payload: singleQuestionPayload("第一个问题"),
      }),
    });
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-2",
        dialog_payload: singleQuestionPayload("第二个问题"),
      }),
    });
    for (const btn of screen.getAllByRole("button", {
      name: "最小化提问卡片",
    }))
      fireEvent.click(btn);

    // 展开明细列表 → 定点还原 req-1
    fireEvent.click(screen.getByRole("button", { name: "展开最小化列表" }));
    fireEvent.click(
      screen.getByRole("button", { name: "还原 第一个问题" }),
    );

    // 角标 2→1；req-1 回列表（可见、无 hidden），req-2 仍最小化
    expect(screen.getByText("1")).toBeInTheDocument();
    const wrapper = document.querySelector('[data-panel-card="req-1"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toHaveAttribute("hidden");
    expect(wrapper).toHaveAttribute("data-minimized", "false");
    // req-2 仍隐藏：可见的提交按钮只有 req-1 一张
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-panel-card="req-2"]'),
    ).toHaveAttribute("hidden");
  });

  it("permission_resolved 同步：最小化中的卡被移除，角标递减直至胶囊消失", async () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    await flushSse();
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-1",
        dialog_payload: singleQuestionPayload("第一个问题"),
      }),
    });
    await dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-2",
        dialog_payload: singleQuestionPayload("第二个问题"),
      }),
    });
    for (const btn of screen.getAllByRole("button", {
      name: "最小化提问卡片",
    }))
      fireEvent.click(btn);
    expect(screen.getByText("2")).toBeInTheDocument();

    // req-1 resolved：角标 2→1，胶囊标题切到 req-2
    await dispatchMessage(inst, {
      event: "permission_resolved",
      session_id: "sess-1",
      request_id: "req-1",
      decision: "allow",
      reason: "manual",
    });
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "第二个问题" }),
    ).toBeInTheDocument();

    // req-2 resolved：最小化集合清空 → 胶囊整体消失
    await dispatchMessage(inst, {
      event: "permission_resolved",
      session_id: "sess-1",
      request_id: "req-2",
      decision: "allow",
      reason: "manual",
    });
    expect(
      screen.queryByRole("group", { name: "最小化的待决策卡片" }),
    ).not.toBeInTheDocument();
  });
});

describe("AskUserDialogCard minimized/onMinimize（task-08 组件级）", () => {
  it("不传 onMinimize 无最小化按钮；minimized=true 渲染 null；还原后已选保留", () => {
    const request = makeDialogRequest();
    const { container, rerender } = render(
      <AskUserDialogCard request={request} />,
    );
    // 向后兼容：不传 onMinimize → 不渲染最小化按钮
    expect(
      screen.queryByRole("button", { name: "最小化提问卡片" }),
    ).not.toBeInTheDocument();

    // 先选一个选项 → 提交启用
    fireEvent.click(screen.getByText("Next.js"));
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).not.toBeDisabled();

    // minimized=true → 渲染 null（组件保持挂载，hooks 照常）
    rerender(
      <AskUserDialogCard request={request} minimized onMinimize={() => {}} />,
    );
    expect(container.firstChild).toBeNull();

    // rerender 回 false → 已选选项保留（state 未丢）
    rerender(
      <AskUserDialogCard
        request={request}
        minimized={false}
        onMinimize={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).not.toBeDisabled();
  });
});

describe("PermissionApprovalCard minimized/onMinimize（task-08 组件级）", () => {
  it("传 onMinimize → 按钮存在且回调收 request_id；minimized=true 渲染 null", () => {
    const request: SessionPermissionRequest = {
      session_id: "sess-1",
      run_id: "run-1",
      request_id: "perm-req-1",
      tool_name: "Bash",
      input: { command: "ls" },
    };
    const onMinimize = vi.fn();
    const { container, rerender } = render(
      <PermissionApprovalCard request={request} onMinimize={onMinimize} />,
    );
    const btn = screen.getByRole("button", { name: "最小化审批卡片" });
    fireEvent.click(btn);
    expect(onMinimize).toHaveBeenCalledWith("perm-req-1");

    rerender(
      <PermissionApprovalCard
        request={request}
        minimized
        onMinimize={onMinimize}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
