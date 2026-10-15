// 2026-10-15-change-detail-redesign / task-06（FR-01 / FR-08）：
// 概览面板测试——在途 vs 归档首屏差异、待办卡显隐、最近动态倒序且为轻量行
// （MUST NOT 含阶段筛选 chips 与「合并口径」说明——那两者只属「过程」tab）。
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeOverviewPanel } from "@/components/changes/detail/change-overview-panel";
import { mergeChangeTimeline } from "@/components/changes/detail/merge-change-timeline";
import { getChangeAssets, getChangeUsage, getScopeAudit } from "@/lib/changes";
import type { ChangeRead } from "@/lib/changes";

const mocks = vi.hoisted(() => ({ stageActions: vi.fn() }));

vi.mock("@/lib/changes", () => ({
  getChangeAssets: vi.fn(),
  getChangeUsage: vi.fn(),
  getScopeAudit: vi.fn(),
}));

vi.mock("@/components/changes/detail/change-stage-actions", () => ({
  ChangeStageActions: (props: Record<string, unknown>) => {
    mocks.stageActions(props);
    return <div data-testid="stub-stage-actions" />;
  },
}));

const mockAssets = vi.mocked(getChangeAssets);
const mockUsage = vi.mocked(getChangeUsage);
const mockAudit = vi.mocked(getScopeAudit);

function changeFixture(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "c-1",
    workspace_id: "ws-1",
    change_key: "2026-10-15-demo",
    title: "示例变更",
    description: "描述",
    status: "active",
    location: "active",
    change_type: "full",
    current_stage: "execute",
    created_at: "2026-10-15T12:00:00Z",
    updated_at: "2026-10-16T01:00:00Z",
    owner_name: "qinyi",
    affected_components: [],
    steps: [
      {
        name: "需求分析完成",
        stage: "brainstorm",
        status: "completed",
        output: null,
        completed_at: "2026-10-15T21:08:00Z",
        ordering: 1,
        wait_reason: null,
        kind: "step",
        event_type: null,
      },
    ],
    ...over,
  } as ChangeRead;
}

const ROWS = mergeChangeTimeline({
  bornAt: null,
  steps: [
    {
      name: "早的动作",
      stage: "brainstorm",
      status: "completed",
      output: null,
      completed_at: "2026-10-15T21:00:00Z",
      ordering: 1,
      wait_reason: null,
      kind: "step",
      event_type: null,
    },
    {
      name: "晚的动作",
      stage: "execute",
      status: "completed",
      output: null,
      completed_at: "2026-10-16T01:00:00Z",
      ordering: 2,
      wait_reason: null,
      kind: "step",
      event_type: null,
    },
  ],
  events: [],
});

function renderPanel(archived = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChangeOverviewPanel
        change={changeFixture()}
        workspaceId="ws-1"
        changeId="c-1"
        archived={archived}
        recentRows={ROWS}
        taskSummary={{ checked: 2, total: 5 }}
        sessions={[]}
        boundSession={null}
        gateComment=""
        onGateCommentChange={() => undefined}
        onGateAction={() => undefined}
        transitioning={false}
        notifyResult={null}
      />
    </QueryClientProvider>,
  );
}

describe("ChangeOverviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssets.mockResolvedValue({
      change_key: "2026-10-15-demo",
      archived: true,
      fr_entries: [{ id: "FR-01", title: "t", status: "active", file: "f.md" }],
      decisions: [],
      test_rows: [],
      patch: {
        files: 26,
        additions: 1820,
        deletions: 430,
        patch_status: "ok",
        saved_at: null,
        file_list: [],
        files_truncated: false,
      },
      delta: { headline: "h", before_lines: 100, delta_lines: 40 },
      knowledge_touch: [],
      touched_modules: [],
    } as never);
    mockUsage.mockResolvedValue({
      started_at: "2026-10-16T00:00:00Z",
      finished_at: null,
      duration_ms: 3_600_000,
      totals: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 100,
        cache_creation_tokens: 0,
        api_requests: 12,
        num_turns: 4,
      },
      by_model: [],
    } as never);
    mockAudit.mockResolvedValue({ ok: true, rows: [], repos: [] } as never);
  });

  it("在途首屏：待办卡挂载 + 变更摘要四格 + 最近动态", async () => {
    renderPanel(false);
    expect(await screen.findByTestId("stub-stage-actions")).toBeInTheDocument();
    expect(screen.getByTestId("change-overview-summary")).toBeInTheDocument();
    expect(screen.getByText("变更摘要")).toBeInTheDocument();
    expect(screen.getByText("当前阶段")).toBeInTheDocument();
    expect(screen.getByText("任务进度")).toBeInTheDocument();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(screen.getByText("最近动态")).toBeInTheDocument();
    expect(screen.getByTestId("change-overview-recent")).toBeInTheDocument();
    // 在途态不渲染归档留档摘要卡（两态互不出现对方空位）
    expect(screen.queryByTestId("change-overview-ledger")).not.toBeInTheDocument();
  });

  it("归档首屏：成果总结四格 + 归档留档摘要 + 最终动态，且不渲染待办卡", async () => {
    renderPanel(true);
    const summary = within(await screen.findByTestId("change-overview-summary"));
    expect(summary.getByText("成果总结")).toBeInTheDocument();
    expect(summary.getByText("需求规则")).toBeInTheDocument();
    expect(summary.getByText("净增行")).toBeInTheDocument();
    expect(await summary.findByText("+1820 / −430")).toBeInTheDocument();
    expect(screen.getByTestId("change-overview-ledger")).toBeInTheDocument();
    expect(screen.getByText("最终动态")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-stage-actions")).not.toBeInTheDocument();
    expect(mocks.stageActions).not.toHaveBeenCalled();
  });

  it("最近动态为倒序轻量行，且不含阶段筛选 chips 与合并口径说明（那两者只属过程 tab）", () => {
    renderPanel(false);
    const rows = screen.getAllByTestId("change-overview-recent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("晚的动作"); // 倒序：最新在上
    expect(rows[1]?.textContent).toContain("早的动作");
    expect(screen.queryByText(/合并口径：源内按稳定键去重/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /全部/ })).not.toBeInTheDocument();
    expect(screen.queryByText("点击阶段可筛选；与上方阶段条联动")).not.toBeInTheDocument();
  });
});
