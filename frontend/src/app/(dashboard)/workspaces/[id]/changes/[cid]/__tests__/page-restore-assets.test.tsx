// 2026-09-26-change-detail-restore-assets：页面级钉子——304eba982 曾把并行会话
// 基于旧分叉点的 page.tsx 整体夹带进 main，静默回滚了 9/25 落地的沉淀资产卡挂载、
// STATUS_BADGE.thin 徽章与范围对账 archived 传参（线上右下角项目资产消失、轻量
// 变更标识弱化）。本测试把三处恢复钉在整页渲染面上，下次任何提交再删挂载/徽章
// 会被聚焦测试拦下，而不是等到线上被发现。
//
// 断言面（对应 FR-01 / FR-02 / FR-03）：
//   1. current_stage="thin" → 标题旁 STATUS_BADGE 徽章精确文本「轻量变更」
//      （说明卡标题带 ◈ 前缀、正文为长句，exact 匹配不误中）
//   2. aside 同时挂载沉淀资产卡与观测事件卡（ChangeAssetsCard 恢复挂载，
//      ChangeObservationEventsCard 为 304eba982 有效交付，二者并存不互斥）
//   3. 范围对账卡收到 archived 传参（isTerminalChange 派生，非终态 false）
//
// 卡片组件全部 stub（只验页面挂载与传参，组件内部由各自套件覆盖），范式对齐
// 同目录 page-team-toggle.test.tsx。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChangeDetailPage from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
import type { ChangeRead, DispatchResponse } from "@/lib/changes";
import { getChangeTimeline } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

const mocks = vi.hoisted(() => ({
  getChange: vi.fn(),
  getAgentStatus: vi.fn(),
  submitStageReview: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  listQuicklogEntries: vi.fn(),
}));

vi.mock("@/lib/changes", () => ({
  getChange: mocks.getChange,
  getAgentStatus: mocks.getAgentStatus,
  submitStageReview: mocks.submitStageReview,
  // 2026-09-26-change-real-timeline：steps 空的 fixture 走合成时间线分支，
  // 组件自取数走此 mock（默认 reject → 卡静默隐藏，不涉断言面）。
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline-in-page-tests")),
}));

vi.mock("@/lib/daemon", () => ({
  listWorkspaceAgentSessions: mocks.listWorkspaceAgentSessions,
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// 自取数只读卡 stub：挂载断言面（testid 存在即挂载），内部行为由组件套件覆盖
vi.mock("@/components/changes/detail/change-assets-card", () => ({
  ChangeAssetsCard: () => <div data-testid="change-assets-card" />,
}));
vi.mock(
  "@/components/changes/detail/change-observation-events-card",
  () => ({
    ChangeObservationEventsCard: () => (
      <div data-testid="change-observation-events-card" />
    ),
  }),
);
// 范围对账卡 stub 透传 archived（FR-03 传参断言面；target 字面量同页透传不验）
vi.mock("@/components/changes/scope-audit-command-card", () => ({
  ScopeAuditCommandCard: ({
    archived,
  }: {
    archived?: boolean;
    target?: unknown;
  }) => (
    <div
      data-testid="scope-audit-command-card"
      data-archived={archived === undefined ? "unset" : String(archived)}
    />
  ),
}));
vi.mock("@/components/changes/detail/change-agent-run-log", () => ({
  ChangeAgentRunLog: () => <div data-testid="change-agent-run-log" />,
}));
vi.mock("@/components/changes/detail/change-files-card", () => ({
  ChangeFilesCard: () => <div data-testid="change-files-card" />,
}));
vi.mock("@/components/changes/detail/change-sessions-card", () => ({
  ChangeSessionsCard: () => <div data-testid="change-sessions-card" />,
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

function makeChange(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "ch-thin-1",
    change_key: "2026-09-26-restore-fixture",
    title: "恢复钉子 fixture",
    current_stage: "thin",
    pending_review: null,
    status: "in_progress",
    location: "active",
    change_type: "quick",
    affected_components: [],
    updated_at: "2026-09-26T10:00:00Z",
    stages: {},
    ...over,
  } as unknown as ChangeRead;
}

function renderPage(change: ChangeRead) {
  mocks.getChange.mockResolvedValue(change);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeDetailPage
        params={{ id: "ws-1", cid: change.id }}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getAgentStatus.mockResolvedValue(null as unknown as DispatchResponse);
  mocks.listWorkspaceAgentSessions.mockResolvedValue(
    [] as unknown as AgentSessionListItem[],
  );
  mocks.listQuicklogEntries.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("变更详情页恢复钉子（2026-09-26-change-detail-restore-assets）", () => {
  it("FR-02：thin 阶段标题旁显示 STATUS_BADGE「轻量变更」徽章", async () => {
    renderPage(makeChange());
    expect(await screen.findByText("轻量变更")).toBeInTheDocument();
    // 说明卡标题带 ◈ 前缀，与徽章 exact 文本互不干扰（两条各命中一次）
    expect(screen.getByText("◈ 轻量变更")).toBeInTheDocument();
  });

  it("FR-01：aside 同时挂载沉淀资产卡与观测事件卡", async () => {
    renderPage(makeChange());
    expect(
      await screen.findByTestId("change-assets-card"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("change-observation-events-card"),
    ).toBeInTheDocument();
  });

  it("FR-03：范围对账卡收到 archived 传参（非终态变更为 false，非 unset）", async () => {
    renderPage(makeChange());
    const card = await screen.findByTestId("scope-audit-command-card");
    expect(card).toHaveAttribute("data-archived", "false");
  });

  it("FR-03 伴生：已归档变更 archived 派生为 true", async () => {
    renderPage(makeChange({ status: "archived", location: "archive" }));
    const card = await screen.findByTestId("scope-audit-command-card");
    expect(card).toHaveAttribute("data-archived", "true");
  });

  it("FR-03（2026-09-26-change-real-timeline）：steps 为空时主线挂载真实留痕时间线卡", async () => {
    vi.mocked(getChangeTimeline).mockResolvedValue({
      change_key: "2026-09-26-restore-fixture",
      born_at: "2026-09-26T10:00:00.000Z",
      events: [
        {
          ts: "2026-09-26T10:01:00Z",
          kind: "file-update",
          label: "requirements.md 内容变更",
          rule: "watcher",
          severity: "info",
          provisional: true,
          commit_title: null,
        },
      ],
      tasks: [
        { id: "task-01", checked: true, desc: "恢复钉子", commit_sha: null },
      ],
      stats: {
        event_count: 1,
        commit_count: 0,
        checked: 1,
        total: 1,
        wall_clock_s: null,
      },
    });
    renderPage(makeChange());
    expect(
      await screen.findByTestId("change-timeline-card"),
    ).toBeInTheDocument();
    // steps 为空 → 原步骤时间线整块不渲染（空窗由时间线卡填补）。
    expect(
      screen.queryByTestId("change-step-timeline-card"),
    ).toBeNull();
  });
});
