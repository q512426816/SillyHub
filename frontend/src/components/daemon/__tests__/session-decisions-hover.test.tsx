import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fetchSessionDialogHistory 解耦后端（本文件测 UI 分组/交互/详情解析；数据层
// fetch 函数有独立职责）。@/lib/daemon 其余导出在本组件渲染树中仅剩类型
// （编译期擦除），整模块 mock 不影响。
vi.mock("@/lib/daemon", () => ({
  fetchSessionDialogHistory: vi.fn(),
}));

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SessionDecisionsHover,
  splitDecisions,
} from "@/components/daemon/session-decisions-hover";
import { fetchSessionDialogHistory } from "@/lib/daemon";
import type {
  SessionDialogRead,
  SessionPermissionRequest,
} from "@/lib/daemon";

const mockedFetch = vi.mocked(fetchSessionDialogHistory);

/* ------------------------------------------------------------------ */
/* 工厂                                                                */
/* ------------------------------------------------------------------ */

function pendingReq(partial: Partial<SessionPermissionRequest> = {}): SessionPermissionRequest {
  return {
    session_id: "s-1",
    run_id: "r-1",
    request_id: "req-1",
    tool_name: "AskUserQuestion",
    input: {},
    dialog_kind: "ask_user",
    dialog_payload: {
      questions: [{ question: "使用哪个数据库？", options: [{ label: "SQLite" }] }],
    },
    ...partial,
  } as SessionPermissionRequest;
}

function historyRow(partial: Partial<SessionDialogRead> = {}): SessionDialogRead {
  return {
    id: "d-1",
    session_id: "s-1",
    run_id: "r-1",
    request_id: "req-h1",
    tool_name: "AskUserQuestion",
    dialog_kind: "ask_user",
    dialog_payload: {
      questions: [
        {
          question: "部署目标环境是什么？",
          options: [
            { label: "阿里云 ECS", description: "单机 Docker Compose" },
            { label: "本地开发机" },
          ],
        },
      ],
    },
    status: "answered",
    answer: { answers: [{ answer: "阿里云 ECS" }] },
    created_at: "2026-10-14T01:30:00Z",
    answered_at: "2026-10-14T01:31:00Z",
    ...partial,
  } as SessionDialogRead;
}

function renderUi(props?: Partial<Parameters<typeof SessionDecisionsHover>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionDecisionsHover
        sessionId="s-1"
        pendingRequests={[]}
        planPending={null}
        onFocusPending={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

/** 打开下拉：2026-10-16-session-pill-dock-drag 起 click 触发（hover 不再弹）。 */
async function openPopover() {
  fireEvent.click(screen.getByTestId("session-decisions-hover").querySelector("button")!);
  await screen.findByTestId("session-decision-popover");
}

beforeEach(() => {
  mockedFetch.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* splitDecisions（纯函数，FR-02 分组口径）                             */
/* ------------------------------------------------------------------ */

describe("splitDecisions（纯函数）", () => {
  it("pending dialog + planPending → 待决策组；kind 按 dialog_kind 派生", () => {
    const { pending } = splitDecisions(
      [
        pendingReq({ request_id: "req-1" }),
        pendingReq({
          request_id: "req-2",
          dialog_kind: "plan_approval",
          dialog_payload: { questions: [{ question: "Agent 提交了执行计划等待审批" }] },
        }),
      ],
      { runId: "r-9", summary: { objective: "", tasks: [] }, requestedAt: "2026-10-16T03:18:00Z" },
      [],
    );
    expect(pending.map((p) => p.key)).toEqual(["req-1", "req-2", "plan"]);
    expect(pending.map((p) => p.kind)).toEqual(["ask", "plan", "plan"]);
    expect(pending.every((p) => p.status === "waiting")).toBe(true);
    expect(pending[2]?.createdAt).toBe("2026-10-16T03:18:00Z");
  });

  it("历史行：answered 归历史组带回答摘要；cancelled 显示未回答", () => {
    const { history } = splitDecisions([], null, [
      historyRow(),
      historyRow({
        id: "d-2",
        request_id: "req-h2",
        status: "cancelled",
        answer: null,
        answered_at: null,
      }),
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe("answered");
    expect(history[0]?.answerSummary).toBe("阿里云 ECS");
    expect(history[1]?.status).toBe("unanswered");
    expect(history[1]?.answerSummary).toBeNull();
  });

  it("孤儿 pending 行（不在 SSE 待答集）归历史组显示未回答，不算待决策", () => {
    const orphan = historyRow({
      id: "d-o",
      request_id: "req-orphan",
      status: "pending",
      answer: null,
      answered_at: null,
    });
    const { pending, history } = splitDecisions([pendingReq({ request_id: "req-1" })], null, [orphan]);
    expect(pending.map((p) => p.key)).toEqual(["req-1"]);
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("unanswered");
    expect(history[0]?.answerSummary).toBeNull();
  });

  it("历史 undefined（未加载）时只看 pending 组", () => {
    const { pending, history } = splitDecisions([pendingReq()], null, undefined);
    expect(pending).toHaveLength(1);
    expect(history).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 组件渲染（FR-01 显隐 / FR-02 下拉 / FR-03 点击 / FR-04 详情）         */
/* ------------------------------------------------------------------ */

describe("SessionDecisionsHover（2026-10-16-session-decision-pill task-05）", () => {
  it("三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）", async () => {
    const { container } = renderUi();
    // 历史未就绪（Promise 未决/空）期间 pending 为空 → null
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith("s-1"));
    await waitFor(() =>
      expect(container.querySelector('[data-testid="session-decisions-hover"]')).toBeNull(),
    );
  });

  it("pending 渲染入口：徽标 = 待决策数且呼吸；悬停历史经 fetchSessionDialogHistory 拉取", async () => {
    renderUi({
      pendingRequests: [pendingReq()],
      planPending: { runId: "r-9", summary: { objective: "", tasks: [] }, requestedAt: null },
    });
    expect(screen.getByTestId("session-decision-count").textContent).toBe("2");
    expect(screen.getByTestId("session-decision-count").className).toContain("animate-pulse");
    expect(mockedFetch).toHaveBeenCalledWith("s-1");
  });

  it("点击弹下拉（hover 不再触发）：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）", async () => {
    mockedFetch.mockResolvedValue([historyRow()]);
    renderUi({
      pendingRequests: [
        pendingReq(),
        pendingReq({
          request_id: "req-plan",
          dialog_kind: "plan_approval",
          dialog_payload: { questions: [{ question: "Agent 提交了执行计划等待审批" }] },
        }),
      ],
    });
    // 2026-10-16-session-pill-dock-drag：hover 移入不再弹下拉（防误触）
    fireEvent.mouseEnter(screen.getByTestId("session-decisions-hover").querySelector("button")!);
    expect(screen.queryByTestId("session-decision-popover")).toBeNull();

    await openPopover();

    expect(screen.getByText("待决策（2）")).toBeTruthy();
    expect(screen.getByText("提问")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    // 历史默认收起（click 即开无 hover 延迟，findBy 等历史查询落地）
    expect(screen.queryByTestId("session-decision-item-req-h1")).toBeNull();
    const toggle = await screen.findByTestId("session-decision-history-toggle");
    expect(toggle.textContent).toContain("已答历史（1）");
  });

  it("历史组展开显示回答摘要；再点收起", async () => {
    mockedFetch.mockResolvedValue([historyRow()]);
    renderUi({ pendingRequests: [pendingReq()] });
    await openPopover();

    const toggle = await screen.findByTestId("session-decision-history-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("session-decision-item-req-h1")).toBeTruthy();
    expect(screen.getByText("你的回答：阿里云 ECS")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByTestId("session-decision-item-req-h1")).toBeNull();
  });

  it("点 pending dialog 项：上抛 onFocusPending(requestId)；点 plan 项上抛 'plan' 哨兵（FR-03）", async () => {
    const onFocusPending = vi.fn();
    renderUi({
      pendingRequests: [pendingReq({ request_id: "req-42" })],
      planPending: { runId: "r-9", summary: { objective: "", tasks: [] }, requestedAt: null },
      onFocusPending,
    });
    await openPopover();

    fireEvent.click(screen.getByTestId("session-decision-item-req-42"));
    expect(onFocusPending).toHaveBeenCalledWith("req-42");

    fireEvent.click(screen.getByTestId("session-decision-item-plan"));
    expect(onFocusPending).toHaveBeenCalledWith("plan");
  });

  it("点历史项收起下拉并开只读详情弹窗：问题/选项/当时选择 ✓/时间（FR-04）", async () => {
    mockedFetch.mockResolvedValue([historyRow()]);
    renderUi({ pendingRequests: [pendingReq()] });
    await openPopover();

    fireEvent.click(await screen.findByTestId("session-decision-history-toggle"));
    fireEvent.click(screen.getByTestId("session-decision-item-req-h1"));
    // 弹窗内断言（role=dialog 圈定，避免与下拉列表文本重复命中）
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("决策详情")).toBeTruthy();
    expect(within(dialog).getByText("部署目标环境是什么？")).toBeTruthy();
    expect(within(dialog).getByText("你的选择")).toBeTruthy();
    expect(within(dialog).getByText("阿里云 ECS", { exact: false })).toBeTruthy();
    expect(within(dialog).getByText("本地开发机")).toBeTruthy();
    expect(within(dialog).getByText("已答")).toBeTruthy();
    // 未选选项无 ✓ 标记
    const unselected = within(dialog).getByText("本地开发机").closest("div")!;
    expect(unselected.textContent).not.toContain("你的选择");
  });

  it("自定义文本作答（不匹配任何选项）详情弹窗内回显作答行——列表摘要有的信息弹窗不丢", async () => {
    mockedFetch.mockResolvedValue([
      historyRow({
        id: "d-c",
        request_id: "req-custom",
        answer: { answers: [{ answer: "这三种都做一个原型图，我看完后确认。" }] },
      }),
    ]);
    renderUi();
    // 无 pending：pill 等历史加载完成才渲染（FR-01 显隐），先等入口出现
    await waitFor(() =>
      expect(screen.getByTestId("session-decisions-hover")).toBeTruthy(),
    );
    await openPopover();
    fireEvent.click(screen.getByTestId("session-decision-history-toggle"));
    fireEvent.click(screen.getByTestId("session-decision-item-req-custom"));
    const dialog = await screen.findByRole("dialog");
    // 选项全未选（○），自定义回答必须出现在弹窗内
    expect(within(dialog).getByText(/你的回答（自定义文本）/).textContent).toContain(
      "这三种都做一个原型图，我看完后确认。",
    );
    // 选项命中作答的历史行不显示自定义行（第一条 req-h1 命中"阿里云 ECS"）
    fireEvent.click(within(dialog).getByText("关闭"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
  });

  it("无 pending 但有已答历史时仍渲染入口，徽标 0 不呼吸（FR-01）", async () => {
    mockedFetch.mockResolvedValue([historyRow()]);
    renderUi();
    await waitFor(() =>
      expect(screen.getByTestId("session-decisions-hover")).toBeTruthy(),
    );
    expect(screen.getByTestId("session-decision-count").textContent).toBe("0");
    expect(screen.getByTestId("session-decision-count").className).not.toContain("animate-pulse");
  });
});
