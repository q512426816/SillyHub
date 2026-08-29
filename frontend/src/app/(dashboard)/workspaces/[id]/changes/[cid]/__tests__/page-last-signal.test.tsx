/**
 * task-12（2026-08-29-change-delete-closure-and-spec-pull / FR-09 / D-007@v1）：
 * 详情页头部「最后信号」测试（design §8.1）。
 *
 * 覆盖 task 验收：
 *   - change.steps 有 completed_at → 头部（ChangeStageHeader 区域下方）渲染
 *     「最后信号：x 分钟前」，取 steps 最大 completed_at（每步 --done 推送时点，
 *     ChangeRead 无 last_pushed_at——task-11 只落列表 ChangeSummary，纯前端派生）；
 *   - steps 缺失 / 无 completed_at → 整行不渲染（降级零噪音）；
 *   - completed_at 畸形串 → 回退显示原文，不炸组件（ISO_LIKE_RE 白名单范式）；
 *   - 零新增网络请求：详情数据仍走既有 getChange（10s 详情轮询），无新端点调用。
 *
 * mock 范式照 page-team-toggle.test.tsx：只读卡片 stub + lib mock +
 * QueryClientProvider 包装渲染。completed_at 用真实时钟构造（5min 距分档边界远，
 * 零 flake；分档/边界细节在 change-activity-badge.test.tsx 组件级钉死）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChangeDetailPage from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
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

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// 只读卡片 stub：聚焦头部「最后信号」，不测这些组件内部
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
vi.mock("@/components/changes/detail/change-step-timeline", () => ({
  ChangeStepTimeline: () => <div data-testid="change-step-timeline" />,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── fixtures ───────────────────────────────────────────────────────────────

function makeChange(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-08-29-test-change",
    title: "测试变更",
    current_stage: "execute",
    pending_review: null,
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: ["frontend"],
    updated_at: "2026-08-29T10:00:00Z",
    stages: {},
    ...over,
  } as unknown as ChangeRead;
}

function makeSession(): AgentSessionListItem {
  return {
    id: "sess-12345678",
    provider: "claude",
    status: "active",
    turn_count: 3,
    mode: null,
    author: { user_id: "u1", display_name: "小明" },
    last_active_at: "2026-08-29T09:00:00Z",
    title: "帮我推进一下这个变更",
  };
}

function setup(opts: { change?: ChangeRead } = {}) {
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
  mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
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

describe("详情页头部「最后信号」（task-12 / design §8.1）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("steps 有 completed_at → 渲染「最后信号：x 分钟前」，取最大（最近推送）时点", async () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    setup({
      change: makeChange({
        steps: [
          {
            name: "进度确认",
            stage: "execute",
            status: "completed",
            output: null,
            completed_at: "2026-08-28T01:00:00Z",
            ordering: 1,
            wait_reason: null,
          },
          {
            name: "实现核心逻辑",
            stage: "execute",
            status: "completed",
            output: null,
            completed_at: recent,
            ordering: 2,
            wait_reason: null,
          },
        ] as NonNullable<ChangeRead["steps"]>,
      }),
    });
    await renderPage();
    const line = screen.getByTestId("change-last-signal");
    expect(line).toHaveTextContent("最后信号：5 分钟前");
    // title 悬停保留 ISO 原文（对齐 StepTime title=completed_at 惯例）
    expect(line).toHaveAttribute("title", recent);
  });

  it("steps 缺失（旧变更未上行）→ 「最后信号」整行不渲染（降级零噪音）", async () => {
    setup({ change: makeChange({ steps: null }) });
    await renderPage();
    expect(screen.queryByTestId("change-last-signal")).not.toBeInTheDocument();
  });

  it("steps 全部无 completed_at → 同样不渲染", async () => {
    setup({
      change: makeChange({
        steps: [
          {
            name: "实现核心逻辑",
            stage: "execute",
            status: "in-progress",
            output: null,
            completed_at: null,
            ordering: 1,
            wait_reason: null,
          },
        ] as NonNullable<ChangeRead["steps"]>,
      }),
    });
    await renderPage();
    expect(screen.queryByTestId("change-last-signal")).not.toBeInTheDocument();
  });

  it("completed_at 畸形串 → 回退显示原文，组件不抛错（ISO_LIKE_RE 白名单回退）", async () => {
    setup({
      change: makeChange({
        steps: [
          {
            name: "坏数据步骤",
            stage: "execute",
            status: "completed",
            output: null,
            completed_at: "garbage-time",
            ordering: 1,
            wait_reason: null,
          },
        ] as NonNullable<ChangeRead["steps"]>,
      }),
    });
    await renderPage();
    expect(screen.getByTestId("change-last-signal")).toHaveTextContent(
      "最后信号：garbage-time",
    );
  });

  it("零新增网络请求：仅既有 getChange/getAgentStatus/getTaskBoard/会话/quicklog 拉取", async () => {
    setup({ change: makeChange({ steps: null }) });
    await renderPage();
    // 「最后信号」为纯前端派生（steps 最大 completed_at），不引入任何新 lib 调用；
    // getChange 恒为 1（首载，关轮询渲染）。
    expect(mocks.getChange).toHaveBeenCalledTimes(1);
  });
});
