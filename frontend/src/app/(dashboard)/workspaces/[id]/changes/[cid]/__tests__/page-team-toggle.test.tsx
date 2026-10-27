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
//   1. 只读展示区保留（文件卡/会话卡/执行日志；审核历史/任务看板卡已删 ql-20260910-013）
//   2. 无任何执行控制按钮（触发智能体 / 推进到 / 运行验证门禁 / 团队 switch）
//   3. 审批卡「通过/打回并通知绑定会话」→ submitStageReview(action, undefined, notify_session=true)
//   4. 三类降级提示（session_inactive / turn_conflict）随响应渲染
//   5. 步骤时间线挂载：有 steps 明细渲染区块，steps 缺失降级不渲染（task-07）
//
// 只读卡片组件全部 stub（不测其内部），ChangeStageActions 保持真实（审批卡契约）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  within,
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
// 2026-10-15-change-detail-redesign / task-07：页面改为 tab 容器后直接消费 next/navigation
// （useRouter 做 ?tab= 钳制、useSearchParams 读唯一源）——注入 app-router 上下文，
// 范式对齐同层列表页 page.test.tsx。
const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace }),
  useSearchParams: () => navMocks.searchParams,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
import type { ChangeRead, DispatchResponse } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

// ── mocks（hoisted，让 mock 工厂能引用同一组 vi.fn）──────────────────────
const mocks = vi.hoisted(() => ({
  getChange: vi.fn(),
  getAgentStatus: vi.fn(),
  submitStageReview: vi.fn(),
  listChangeSessions: vi.fn(),
  listQuicklogEntries: vi.fn(),
}));

vi.mock("@/lib/changes", () => ({
  getChange: mocks.getChange,
  getAgentStatus: mocks.getAgentStatus,
  submitStageReview: mocks.submitStageReview,
  // 合成时间线：steps 空的 fixture 走合成时间线分支（默认 reject → 统一时间线空态，
  // 不涉网点断言面）。
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline-in-page-tests")),
  // 2026-10-15-change-detail-redesign / task-07：概览面板与信息栏复用这两个端点
  // （assets/usage）与对账端点，页面级测试一律 reject → 面板走降级态，不干扰断言面。
  getChangeAssets: vi.fn().mockRejectedValue(new Error("no-assets-in-page-tests")),
  getChangeUsage: vi.fn().mockRejectedValue(new Error("no-usage-in-page-tests")),
  getScopeAudit: vi.fn().mockRejectedValue(new Error("no-audit-in-page-tests")),
}));

vi.mock("@/lib/daemon", () => ({
  listChangeSessions: mocks.listChangeSessions,
}));

// task-10（FR-07）：关联快速任务卡 mock（默认空列表——卡片渲染「暂无关联快速任务」）
vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// 2026-10-15-change-detail-redesign / task-07：页面改为 tab 容器后，「变更文件」由
// 「文件与对账」面板内嵌（复用 ChangeFileTree，不再以「打开」按钮 + Dialog 为唯一入口），
// 「会话」由概览右信息栏承接——旧只读卡 stub 随之退役；此处 stub 文件树与对账卡，
// 关联快速任务卡保持真实（其页面级断言在本文件内重指向 files tab）。
vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: (props: { workspaceId: string; changeId: string }) => (
    <div data-testid="change-file-tree" data-ws={props.workspaceId} data-cid={props.changeId} />
  ),
}));
vi.mock("@/components/changes/scope-audit-command-card", () => ({
  ScopeAuditCommandCard: ({ archived }: { archived?: boolean; target?: unknown }) => (
    <div
      data-testid="scope-audit-command-card"
      data-archived={archived === undefined ? "unset" : String(archived)}
    />
  ),
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
    is_thin: false,
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
    mode: null,
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
  // 每个用例重置 tab 参数（模块级 mock 对象跨用例残留会串台）。
  navMocks.searchParams = new URLSearchParams();
  const change = opts.change ?? makeChange();
  mocks.getChange.mockResolvedValue(change);
  mocks.getAgentStatus.mockResolvedValue({
    change_id: "ch-1",
    current_stage: change.current_stage,
    has_active_run: false,
    config_enabled: false,
    last_dispatch: null,
  } as unknown as DispatchResponse);
  mocks.listChangeSessions.mockResolvedValue([makeSession()]);
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

  it("页面结构（task-07 起）：阶段条常驻 + tab 栏 + 概览面板；旧只读卡挂载点退役", async () => {
    setup();
    await renderPage();
    // 智能体运行状态卡不挂载（2026-09-28-change-ux-detail-batch 用户裁决：组件保留供移动端）
    expect(screen.queryByTestId("change-agent-run-log")).toBeNull();
    // 阶段条（宏观进度，ChangeStageHeader 真实渲染；页头徽标同文案 → 用 getAllByText）
    expect(screen.getAllByText("需求分析").length).toBeGreaterThan(0);
    // tab 栏（UnderlineNav role=tablist）+ 默认「概览」面板
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(await screen.findByTestId("change-overview-panel")).toBeInTheDocument();
    // 旧侧栏卡挂载点退役：文件卡/会话卡不再由页面直接挂载（改由面板与信息栏承接）
    expect(screen.queryByTestId("change-files-card")).toBeNull();
    expect(screen.queryByTestId("change-sessions-card")).toBeNull();
  });

  // ── task-10（FR-07）：关联的快速任务反向区块 ─────────────────────────

  it("关联快速任务区块（task-07 起归属「文件与对账」tab）：命中条目列出 + linked_change 参数", async () => {
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
    navMocks.searchParams = new URLSearchParams("tab=files");
    await renderPage();

    const card = await screen.findByTestId("quicklog-linked-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("修侧栏宽度塌陷")).toBeInTheDocument();
    // linked_change 用 change_key 筛选；含空壳占位（ql-20260820-008 默认显示口径）
    await waitFor(() =>
      expect(mocks.listQuicklogEntries).toHaveBeenCalledWith("ws-1", {
        linked_change: "2026-08-14-test-change",
        include_placeholder: true,
        page_size: 20,
      }),
    );
    // 点击跳变更中心快速修复 tab
    const link = screen.getByText("修侧栏宽度塌陷").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/workspaces/ws-1/changes?tab=quicklog",
    );
  });

  it("关联快速任务区块：无关联时整卡不渲染（2026-09-28-change-ux-detail-batch）", async () => {
    setup();
    navMocks.searchParams = new URLSearchParams("tab=files");
    await renderPage();
    // 空列表静默隐藏（有数据才渲染）——等取数落定后再断缺席
    await waitFor(() =>
      expect(mocks.listQuicklogEntries).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("quicklog-linked-card")).toBeNull();
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
    const panel = within(await screen.findByTestId("change-overview-panel"));
    expect(panel.getByText("四件套已生成，请确认")).toBeInTheDocument();
    // 绑定会话只读展示（工作区最近活跃会话）
    expect(panel.getByText("绑定会话（审批结果将通知此会话）")).toBeInTheDocument();
    // 会话标题在审批卡与右信息栏「会话」组各出现一次（信息栏为最近会话列表）→ 用 getAllByText
    expect(panel.getAllByText(/帮我推进一下这个变更/).length).toBeGreaterThan(0);

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

describe("详情页过程面（task-07 起：统一时间线取代两张旧卡）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("steps 有明细 → 「过程」tab 挂载统一时间线（两旧卡 MUST NOT 挂载）", async () => {
    setup({ change: makeChange({ steps: makeSteps() }) });
    navMocks.searchParams = new URLSearchParams("tab=process");
    await renderPage();
    expect(await screen.findByTestId("change-process-panel")).toBeInTheDocument();
    expect(screen.getByTestId("change-unified-timeline")).toBeInTheDocument();
    // D-005@v1 / D-014@v1：旧「步骤时间线卡」与「真实留痕时间线卡」不再挂载
    // （文件与导出保留供移动端；挂载点退役由本断言反钉）。
    expect(screen.queryByTestId("change-step-timeline-card")).toBeNull();
    expect(screen.queryByTestId("change-timeline-card")).toBeNull();
  });

  it("steps 缺失（旧变更未上行）→ 统一时间线走空态而不塌陷（面板仍在场）", async () => {
    setup({ change: makeChange({ steps: [] }) });
    navMocks.searchParams = new URLSearchParams("tab=process");
    await renderPage();
    expect(await screen.findByTestId("change-process-panel")).toBeInTheDocument();
    expect(screen.getByText("暂无过程记录。")).toBeInTheDocument();
  });

  it("概览 tab 懒挂载：不挂过程面（切 tab 才取数与渲染）", async () => {
    setup({ change: makeChange({ steps: makeSteps() }) });
    await renderPage();
    expect(await screen.findByTestId("change-overview-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("change-process-panel")).toBeNull();
    expect(screen.queryByTestId("change-unified-timeline")).toBeNull();
  });
});
