// 真实留痕时间线卡组件测试（2026-09-26-change-real-timeline FR-02/FR-03）。
// 覆盖：三段渲染（事件轴含诞生锚/中文标签、任务面勾选×提交锚、脚注统计）、
// fake-check 告警醒目态、commit 标题展示、失败/空数据静默隐藏（观测事件卡范式）。
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeTimelineCard } from "@/components/changes/detail/change-timeline-card";
import { getChangeTimeline } from "@/lib/changes";

const mocks = vi.hoisted(() => ({ getChangeTimeline: vi.fn() }));

vi.mock("@/lib/changes", () => ({
  getChangeTimeline: mocks.getChangeTimeline,
}));

const mockTimeline = vi.mocked(getChangeTimeline);

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeTimelineCard workspaceId="ws-1" changeId="c-1" />
    </QueryClientProvider>,
  );
}

const GOLDEN = {
  change_key: "k",
  born_at: "2026-09-26T07:00:00.000Z",
  events: [
    {
      ts: "2026-09-26T07:01:00Z",
      kind: "file-update",
      label: "requirements.md 内容变更",
      rule: "watcher",
      severity: "info",
      provisional: true,
      commit_title: null,
    },
    {
      ts: "2026-09-26T07:02:01Z",
      kind: "warning",
      label: "tasks 勾选 task-01 无对应提交",
      rule: "fake-check",
      severity: "warning",
      provisional: true,
      commit_title: null,
    },
    {
      ts: "2026-09-26T07:03:00Z",
      kind: "commit",
      label: "4aed0e824",
      rule: "watcher",
      severity: "info",
      provisional: true,
      commit_title: "feat: 落地（task-01 task-02）",
    },
  ],
  tasks: [
    { id: "task-01", checked: true, desc: "后端聚合服务落盘", commit_sha: "4aed0e824" },
    { id: "task-02", checked: false, desc: "前端组件三段渲染", commit_sha: null },
  ],
  stats: {
    event_count: 3,
    commit_count: 1,
    checked: 1,
    total: 2,
    wall_clock_s: 120,
  },
};

describe("ChangeTimelineCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("三段渲染：诞生锚 + 事件轴（中文标签/commit 标题）+ 任务面（勾选×提交锚）+ 统计", async () => {
    mockTimeline.mockResolvedValue(GOLDEN);
    const { container } = renderCard();

    expect(await screen.findByTestId("change-timeline-card")).toBeInTheDocument();
    // 诞生锚行（工件 created_at 补位）。
    expect(screen.getByTestId("change-timeline-event-born")).toHaveTextContent(
      "变更诞生",
    );
    // 事件轴：file-update 中文标签直显；commit 行哈希 + 标题。
    expect(screen.getByTestId("change-timeline-event-file-update")).toHaveTextContent(
      "requirements.md 内容变更",
    );
    const commitRow = screen.getByTestId("change-timeline-event-commit");
    expect(commitRow).toHaveTextContent("4aed0e824");
    expect(commitRow).toHaveTextContent("feat: 落地（task-01 task-02）");
    // 任务面：勾选态与提交锚。
    const tasks = screen.getByTestId("change-timeline-tasks");
    expect(tasks).toHaveTextContent("task-01");
    expect(tasks).toHaveTextContent("后端聚合服务落盘");
    expect(tasks).toHaveTextContent("4aed0e824");
    // 脚注统计（120s → 2min）。
    expect(screen.getByText(/墙钟 2min/)).toBeInTheDocument();
    expect(container).toHaveTextContent("事件 3 · 提交 1 · 勾选 1/2");
  });

  it("fake-check 告警醒目态（琥珀强调），普通事件不上", async () => {
    mockTimeline.mockResolvedValue(GOLDEN);
    renderCard();

    const warnRow = await screen.findByTestId("change-timeline-event-warning");
    expect(warnRow.className).toContain("text-amber-700");
    expect(
      screen.getByTestId("change-timeline-event-file-update").className,
    ).not.toContain("text-amber-700");
  });

  it("空数据（无事件/无任务/无诞生锚）整卡静默隐藏", async () => {
    mockTimeline.mockResolvedValue({
      change_key: "k",
      born_at: null,
      events: [],
      tasks: [],
      stats: {
        event_count: 0,
        commit_count: 0,
        checked: 0,
        total: 0,
        wall_clock_s: null,
      },
    });
    const { container } = renderCard();
    // 空数据 → null 渲染（无卡片壳）。
    await new Promise((r) => setTimeout(r, 30));
    expect(
      screen.queryByTestId("change-timeline-card"),
    ).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("请求失败静默隐藏（观测事件卡同款范式）", async () => {
    mockTimeline.mockRejectedValue(new Error("boom"));
    const { container } = renderCard();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("change-timeline-card")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
