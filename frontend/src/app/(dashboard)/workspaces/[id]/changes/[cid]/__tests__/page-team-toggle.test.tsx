// task-10（2026-08-14-change-center-conversation-driven / D-003@v1 / D-006@v2）：
// 详情页已退化——删除全部执行控制（推进 / 重新派发 / 验证门禁 / 选档案 / 团队配置，
// 含 quick 分支），保留只读展示区 + 人工审批卡（单端点 submitStageReview + notify_session）。
//
// task-07（2026-08-15-change-step-visibility / FR-03 / D-001@v1 / D-004@v1）：
// 详情数据获取改 react-query useQuery（QueryClientProvider 包装渲染），审批后刷新
// 改 query 失效重取；旧 SillySpecStepProgress 挂载替换为 ChangeStepTimeline
// （数据源 change.steps，steps 缺失降级不渲染，D-003@v1）。
//
// 本测试为整页回归：渲染 [cid]/page.tsx，断言
//   1. 只读展示区保留（文件卡/会话卡/审核历史/任务看板/执行日志）
//   2. 无任何执行控制按钮（触发智能体 / 推进到 / 运行验证门禁 / 团队 switch）
//   3. 审批卡「通过/打回并通知绑定会话」→ submitStageReview(action, undefined, notify_session=true)
//   4. 三类降级提示（session_inactive / turn_conflict）随响应渲染
//   5. 步骤时间线挂载：有 steps 明细渲染区块，steps 缺失降级不渲染（task-07）
//
// 只读卡片组件全部 stub（不测其内部），ChangeStageActions 保持真实（审批卡契约）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import ChangeDetailPage, {
  isTerminalChange,
} from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
import type { ChangeRead, DispatchResponse } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

// ── mocks（hoisted，让 mock 工厂能引用同一组 vi.fn）──────────────────────
const mocks = vi.hoisted(() => ({
  getChange: vi.fn(),
  getAgentStatus: vi.fn(),
  submitStageReview: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  getTaskBoard: vi.fn(),
  listQuicklogEntries: vi.fn(),
}));

vi.mock("@/lib/changes", () => ({
  getChange: mocks.getChange,
  getAgentStatus: mocks.getAgentStatus,
  submitStageReview: mocks.submitStageReview,
}));

vi.mock("@/lib/daemon", () => ({
  listWorkspaceAgentSessions: mocks.listWorkspaceAgentSessions,
}));

vi.mock("@/lib/tasks", () => ({
  getTaskBoard: mocks.getTaskBoard,
}));

// task-10（FR-07）：关联快速任务卡 mock（默认空列表——卡片渲染「暂无关联快速任务」）
vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// 只读卡片 stub：聚焦详情页退化 + 审批卡，不测这些组件内部
vi.mock("@/components/changes/detail/change-agent-run-log", () => ({
  ChangeAgentRunLog: () => <div data-testid="change-agent-run-log" />,
}));
vi.mock("@/components/changes/detail/change-files-card", () => ({
  ChangeFilesCard: () => <div data-testid="change-files-card" />,
}));
vi.mock("@/components/changes/detail/change-review-history-card", () => ({
  ChangeReviewHistoryCard: () => <div data-testid="change-review-history-card" />,
  normalizeReviewHistory: () => [],
}));
vi.mock("@/components/changes/detail/change-sessions-card", () => ({
  ChangeSessionsCard: () => <div data-testid="change-sessions-card" />,
}));
vi.mock("@/components/changes/detail/change-task-board-card", () => ({
  ChangeTaskBoardCard: () => <div data-testid="change-task-board-card" />,
}));
// 步骤时间线只读卡片 stub（task-07 范式同上；空态降级语义在组件自身测试覆盖，
// 此处只验页面挂载/降级门控）
vi.mock("@/components/changes/detail/change-step-timeline", () => ({
  ChangeStepTimeline: ({ steps }: { steps: unknown[] | null }) =>
    steps && steps.length > 0 ? (
      <div data-testid="change-step-timeline" />
    ) : null,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// ── fixtures ───────────────────────────────────────────────────────────────

function makeChange(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-08-14-test-change",
    title: "测试变更",
    current_stage: "brainstorm",
    pending_review: "proposal_review",
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: ["frontend"],
    updated_at: "2026-08-14T10:00:00Z",
    stages: {},
    ...over,
  } as unknown as ChangeRead;
}

/** steps 明细 fixture（StepTimelineEntry 形状，task-07 详情页时间线数据源） */
function makeSteps(): NonNullable<ChangeRead["steps"]> {
  return [
    {
      name: "进度确认",
      stage: "brainstorm",
      status: "completed",
      output: null,
      completed_at: "2026-08-15T15:43:24+00:00",
      ordering: 1,
      wait_reason: null,
    },
    {
      name: "对话式探索",
      stage: "brainstorm",
      status: "in-progress",
      output: null,
      completed_at: null,
      ordering: 2,
      wait_reason: null,
    },
  ] as NonNullable<ChangeRead["steps"]>;
}

function makeSession(): AgentSessionListItem {
  return {
    id: "sess-12345678",
    provider: "claude",
    status: "active",
    turn_count: 3,
    author: { user_id: "u1", display_name: "小明" },
    last_active_at: "2026-08-14T09:00:00Z",
    title: "帮我推进一下这个变更",
  };
}

/**
 * 配置页面异步加载 mock。notify 控制 submitStageReview 的注入结果
 * （默认成功注入，不触发降级）。
 */
function setup(opts: {
  change?: ChangeRead;
  notify?: { notified_session: boolean; notify_error: string | null };
} = {}) {
  const change = opts.change ?? makeChange();
  mocks.getChange.mockResolvedValue(change);
  mocks.getAgentStatus.mockResolvedValue({
    change_id: "ch-1",
    current_stage: change.current_stage,
    has_active_run: false,
    config_enabled: false,
    last_dispatch: null,
  } as unknown as DispatchResponse);
  mocks.listWorkspaceAgentSessions.mockResolvedValue([makeSession()]);
  mocks.getTaskBoard.mockResolvedValue(null);
  // task-10：关联快速任务默认空
  mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
  mocks.submitStageReview.mockResolvedValue({
    change,
    agent_dispatch: null,
    notified_session: opts.notify?.notified_session ?? true,
    notify_error: opts.notify?.notify_error ?? null,
  });
}

// task-07：useQuery 页面渲染需包 QueryClientProvider（retry 关闭 + 关轮询，
// 对齐 sessions/page.test.tsx 范式；hook 级 refetchInterval 函数覆盖默认值不受影响）
async function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ChangeDetailPage params={{ id: "ws-1", cid: "ch-1" }} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText(/测试变更/)).toBeInTheDocument());
}

describe("变更详情页退化（task-10，D-003@v1）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("保留只读展示区：阶段步骤条 / 执行日志 / 文件卡 / 会话卡 / 审核历史 / 任务看板", async () => {
    setup();
    await renderPage();
    expect(screen.getByTestId("change-agent-run-log")).toBeInTheDocument();
    expect(screen.getByTestId("change-files-card")).toBeInTheDocument();
    expect(screen.getByTestId("change-sessions-card")).toBeInTheDocument();
    expect(screen.getByTestId("change-review-history-card")).toBeInTheDocument();
    expect(screen.getByTestId("change-task-board-card")).toBeInTheDocument();
    // 阶段步骤条（主线宏观进度，ChangeStageHeader 真实渲染；页头徽标同文案 → 用 getAllByText）
    expect(screen.getAllByText("需求分析").length).toBeGreaterThan(0);
  });

  // ── task-10（FR-07）：关联的快速任务反向区块 ─────────────────────────

  it("关联快速任务区块：命中条目列出 + linked_change 参数 + 点击跳快速修复 tab", async () => {
    setup();
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        {
          ql_id: "ql-20260817-001",
          timestamp: "2026-08-17T01:30:00Z",
          title: "修侧栏宽度塌陷",
          status: "completed",
          status_note: null,
          placeholder: false,
          author_raw: "qinyi",
          author_name: "秦毅",
          linked_changes: [],
          files: [],
          affected_modules: [],
          source: "file",
        },
      ],
      total: 1,
    });
    await renderPage();

    const card = await screen.findByTestId("quicklog-linked-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("修侧栏宽度塌陷")).toBeInTheDocument();
    // linked_change 用 change_key 筛选
    await waitFor(() =>
      expect(mocks.listQuicklogEntries).toHaveBeenCalledWith("ws-1", {
        linked_change: "2026-08-14-test-change",
        page_size: 20,
      }),
    );
    // 点击跳变更中心快速修复 tab
    const link = screen.getByText("修侧栏宽度塌陷").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/workspaces/ws-1/changes?tab=quicklog",
    );
  });

  it("关联快速任务区块：无关联时空态文案", async () => {
    setup();
    await renderPage();
    expect(
      await screen.findByText("暂无关联快速任务"),
    ).toBeInTheDocument();
  });

  it("无任何执行控制按钮（触发/推进/验证门禁/团队 switch）", async () => {
    setup();
    await renderPage();
    expect(screen.queryByText(/触发智能体/)).not.toBeInTheDocument();
    expect(screen.queryByText(/推进到/)).not.toBeInTheDocument();
    expect(screen.queryByText(/运行验证门禁/)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("审批卡「通过并通知绑定会话」→ submitStageReview(action, notify_session=true)", async () => {
    setup();
    await renderPage();
    expect(screen.getByText("四件套已生成，请确认")).toBeInTheDocument();
    // 绑定会话只读展示（工作区最近活跃会话）
    expect(screen.getByText(/帮我推进一下这个变更/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("通过并通知绑定会话"));
    await waitFor(() =>
      expect(mocks.submitStageReview).toHaveBeenCalledWith(
        "ws-1",
        "ch-1",
        "proposal_approve",
        undefined,
        true,
      ),
    );
    // 注入成功 → 成功提示
    await waitFor(() =>
      expect(screen.getByText(/审批已生效，已通知绑定会话/)).toBeInTheDocument(),
    );
  });

  it("审批卡「打回并通知绑定会话」→ proposal_revise", async () => {
    setup();
    await renderPage();
    fireEvent.click(screen.getByText("打回并通知绑定会话"));
    await waitFor(() =>
      expect(mocks.submitStageReview).toHaveBeenCalledWith(
        "ws-1",
        "ch-1",
        "proposal_revise",
        undefined,
        true,
      ),
    );
  });

  it("降级：session_inactive → 「绑定会话已结束，去会话页开启」", async () => {
    setup({ notify: { notified_session: false, notify_error: "session_inactive" } });
    await renderPage();
    fireEvent.click(screen.getByText("通过并通知绑定会话"));
    await waitFor(() =>
      expect(
        screen.getByText("绑定会话已结束，审批已生效，请去会话页开启新会话"),
      ).toBeInTheDocument(),
    );
  });

  it("降级：turn_conflict → 「agent 忙，稍后会话告知」", async () => {
    setup({ notify: { notified_session: false, notify_error: "turn_conflict" } });
    await renderPage();
    fireEvent.click(screen.getByText("通过并通知绑定会话"));
    await waitFor(() =>
      expect(
        screen.getByText("审批已生效，agent 忙，请稍后在会话中告知继续"),
      ).toBeInTheDocument(),
    );
  });
});

describe("详情页步骤时间线挂载（task-07，D-005@v1）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("change.steps 有明细 → 渲染 ChangeStepTimeline 区块（时间线卡片 + 组件挂载）", async () => {
    setup({ change: makeChange({ steps: makeSteps() }) });
    await renderPage();
    expect(
      screen.getByTestId("change-step-timeline-card"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("change-step-timeline")).toBeInTheDocument();
  });

  it("steps 缺失（旧变更未上行）→ 降级不渲染时间线区块（D-003@v1，视觉与现状一致）", async () => {
    setup({ change: makeChange({ steps: null }) });
    await renderPage();
    expect(
      screen.queryByTestId("change-step-timeline-card"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("change-step-timeline")).not.toBeInTheDocument();
  });

  it("steps 为空数组 → 同样降级不渲染", async () => {
    setup({ change: makeChange({ steps: [] }) });
    await renderPage();
    expect(
      screen.queryByTestId("change-step-timeline-card"),
    ).not.toBeInTheDocument();
  });

  it("终态判定 isTerminalChange（停轮谓词，design §5 Phase 2.4 可测试定义）", () => {
    expect(isTerminalChange({ status: "archived", location: "active" })).toBe(
      true,
    );
    expect(isTerminalChange({ status: "in_progress", location: "archive" })).toBe(
      true,
    );
    // 非终态：两者都不满足 → 继续轮询
    expect(isTerminalChange({ status: "in_progress", location: "active" })).toBe(
      false,
    );
    // 数据未就绪（useQuery 首拉）按非终态处理
    expect(isTerminalChange(null)).toBe(false);
    expect(isTerminalChange(undefined)).toBe(false);
  });

  it("详情查询 error 且无数据（变更被删/404）→ 停轮不无限轮询（ql-20260816-001）", async () => {
    // getChange 首次 404（ApiError）且后续若被轮询会返回成功数据（可区分）；
    // refetchInterval 内联判定 error&&!data → false，等过原 10s 间隔后仍只调一次。
    mocks.getChange.mockRejectedValueOnce(
      new ApiError(404, {
        code: "HTTP_404_CHANGE_NOT_FOUND",
        message: "变更不存在",
        request_id: null,
        details: null,
      }),
    );
    mocks.getChange.mockResolvedValueOnce(makeChange());
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <ChangeDetailPage params={{ id: "ws-1", cid: "ch-1" }} />
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => {
        expect(screen.getByText("变更不存在")).toBeInTheDocument();
      });
      await new Promise((r) => setTimeout(r, 12_000));
      expect(mocks.getChange).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});
