/**
 * 2026-10-28-change-detail-sessions-source-fix FR-01/FR-02：详情页会话数据源。
 *
 * 页面层辅助会话数据源必须是 listChangeSessions(workspaceId, changeId)
 * （GET /changes/{id}/sessions，change_session_links 真实关联），不再取
 * listWorkspaceAgentSessions（工作区全量近似）——概览「会话」区与审批卡
 * 「绑定会话」都消费这一关联源（与后端 _notify_bound_session 注入目标同源）。
 *
 * mock 范式照 page-last-signal.test.tsx：lib mock + 只读卡片 stub。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChangeDetailPage from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace }),
  useSearchParams: () => navMocks.searchParams,
}));

import type { ChangeRead, DispatchResponse } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

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
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline-in-page-tests")),
}));

vi.mock("@/lib/daemon", () => ({
  listChangeSessions: mocks.listChangeSessions,
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
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
vi.mock("@/components/changes/detail/change-step-timeline", () => ({
  ChangeStepTimeline: () => <div data-testid="change-step-timeline" />,
}));

function makeChange(): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-10-28-test-change",
    title: "测试变更",
    current_stage: "execute",
    pending_review: "proposal_review",
    status: "in_progress",
    location: "active",
    change_type: null,
    is_thin: false,
    affected_components: ["frontend"],
    updated_at: "2026-10-28T10:00:00Z",
    stages: {},
    steps: null,
  } as unknown as ChangeRead;
}

function makeSession(over: Partial<AgentSessionListItem> = {}): AgentSessionListItem {
  return {
    id: "sess-bound0001",
    provider: "claude",
    status: "active",
    turn_count: 3,
    mode: null,
    author: { user_id: "u1", display_name: "小明" },
    last_active_at: "2026-10-28T09:00:00Z",
    title: "真实关联会话一号",
    ...over,
  };
}

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

describe("详情页会话数据源（2026-10-28-change-detail-sessions-source-fix FR-01/02）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("数据源调 listChangeSessions(workspaceId, changeId)，概览会话区显示关联会话", async () => {
    mocks.getChange.mockResolvedValue(makeChange());
    mocks.getAgentStatus.mockResolvedValue({
      change_id: "ch-1",
      current_stage: "execute",
      has_active_run: false,
      config_enabled: false,
      last_dispatch: null,
    } as unknown as DispatchResponse);
    mocks.listChangeSessions.mockResolvedValue([makeSession()]);
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });

    await renderPage();

    // FR-01：以 (workspaceId, changeId) 调变更关联端点
    expect(mocks.listChangeSessions).toHaveBeenCalledWith("ws-1", "ch-1");
    // 概览「会话」区显示注入的关联会话标题（slice 前 3 条之一；审批卡
    // 「绑定会话」也展示同一会话 → 多处出现，getAllByText 至少命中）。
    await waitFor(() =>
      expect(screen.getAllByText("真实关联会话一号").length).toBeGreaterThanOrEqual(1),
    );
    // FR-02：审批卡「绑定会话」展示同一关联源首条
    expect(screen.getByText(/绑定会话（审批结果将通知此会话）/)).toBeInTheDocument();
  });

  it("变更零关联会话 → 概览显示「暂无会话」空态，不回退工作区列表", async () => {
    mocks.getChange.mockResolvedValue(makeChange());
    mocks.getAgentStatus.mockResolvedValue({
      change_id: "ch-1",
      current_stage: "execute",
      has_active_run: false,
      config_enabled: false,
      last_dispatch: null,
    } as unknown as DispatchResponse);
    mocks.listChangeSessions.mockResolvedValue([]);
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });

    await renderPage();

    expect(mocks.listChangeSessions).toHaveBeenCalledWith("ws-1", "ch-1");
    await waitFor(() => expect(screen.getByText("暂无会话")).toBeInTheDocument());
  });
});
