// 真实留痕时间线卡组件测试（2026-09-26-change-real-timeline FR-02/FR-03）。
// 覆盖：三段渲染（事件轴含诞生锚/中文标签、任务面勾选×提交锚、脚注统计）、
// fake-check 告警醒目态、commit 标题展示、失败/空数据静默隐藏（观测事件卡范式）、
// 超阈值折叠/展开（2026-09-29-change-detail-timeline-files-polish）。
import { fireEvent, render, screen } from "@testing-library/react";
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
    { id: "task-01", checked: true, desc: "后端聚合服务落盘", commit_sha: "4aed0e824", time: "2026-09-26T07:02:00Z" },
    { id: "task-02", checked: false, desc: "前端组件三段渲染", commit_sha: null, time: null },
    { id: "task-03", checked: true, desc: "观测起点前首勾", commit_sha: null, time: null },
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
    // 勾选时刻（2026-09-27-timeline-task-time）：已勾有时刻 → ≈本地时刻；
    // 未勾不显示时刻列值。2026-09-29-change-detail-timeline-files-polish 起
    // 时刻带 MM-dd 日期前缀（跨天防歧义）；hhmmss 走 zh-CN 本地时区，ISO Z
    // 转本地——断言用同款格式化避免硬编码时区。
    const taskTs = new Date("2026-09-26T07:02:00Z");
    const mm = `${taskTs.getMonth() + 1}`.padStart(2, "0");
    const dd = `${taskTs.getDate()}`.padStart(2, "0");
    expect(tasks.textContent).toContain(
      `≈${mm}-${dd} ${taskTs.toLocaleTimeString("zh-CN", { hour12: false })}`,
    );
    // 已勾但推断断裂/盲窗（time=null）→ 显示 ?；未勾（task-02）无时刻列值。
    expect(tasks.textContent).toContain("?");
    expect(tasks).toHaveTextContent("task-03");
    expect(tasks).toHaveTextContent("观测起点前首勾");
    // provisional 观测角标（FR-02）：卡头 chip。
    expect(screen.getByText("观测")).toBeInTheDocument();
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

// ── 2026-09-28-timeline-anchor-scope：watcher-signal-widen 新事件 kind 图标 ──
it("渲染 gate-run/config-change/fake-check-cleared/verify 四新 kind 图标", async () => {
  mockTimeline.mockResolvedValue({
    change_key: "k",
    born_at: null,
    events: [
      { ts: "2026-09-28T05:00:00Z", kind: "gate-run", label: "门实测 failed（29.6s）", rule: "watcher", severity: "info", provisional: true, commit_title: null },
      { ts: "2026-09-28T05:01:00Z", kind: "config-change", label: "本地配置 local.yaml 有变更（内容不上行）", rule: "watcher", severity: "info", provisional: true, commit_title: null },
      { ts: "2026-09-28T05:02:00Z", kind: "fake-check-cleared", label: "task task-01 勾选证据补齐（提交 abc1234）", rule: "fake-check-cleared", severity: "info", provisional: true, commit_title: null },
      { ts: "2026-09-28T05:03:00Z", kind: "verify", label: "质量扫描记录更新", rule: "watcher", severity: "info", provisional: true, commit_title: null },
    ],
    tasks: [],
    stats: { event_count: 4, commit_count: 0, checked: 0, total: 0, wall_clock_s: 180 },
  });
  renderCard();
  await screen.findByTestId("change-timeline-card");
  const text = screen.getByTestId("change-timeline-card").textContent ?? "";
  expect(text).toContain("门实测 failed");
  expect(text).toContain("local.yaml 有变更");
  expect(text).toContain("勾选证据补齐");
  expect(text).toContain("质量扫描记录更新");
  // 四 kind 均有专属图标（非 fallback ℹ️）：DOM 内四图标各至少一次
  for (const icon of ["🔬", "🔧", "🩹", "🧾"]) {
    expect(screen.getByTestId("change-timeline-card").innerHTML).toContain(icon);
  }
});

// ── 2026-09-29-change-detail-timeline-files-polish：超阈值折叠/展开 ──────
describe("ChangeTimelineCard 事件折叠（阈值 30）", () => {
  function manyEvents(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      ts: `2026-09-26T07:${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
      kind: "file-update",
      label: `事件 ${i + 1}`,
      rule: "watcher",
      severity: "info",
      provisional: true,
      commit_title: null,
    }));
  }

  function respOf(n: number) {
    return {
      change_key: "k",
      born_at: null as string | null,
      events: manyEvents(n),
      tasks: [],
      stats: { event_count: n, commit_count: 0, checked: 0, total: 0, wall_clock_s: null },
    };
  }

  it("≤30 条不折叠（无提示按钮，全部行在场）", async () => {
    mockTimeline.mockResolvedValue(respOf(30));
    renderCard();
    await screen.findByTestId("change-timeline-card");
    expect(screen.queryByTestId("change-timeline-expand")).toBeNull();
    expect(screen.getByText("事件 1")).toBeInTheDocument();
    expect(screen.getByText("事件 30")).toBeInTheDocument();
  });

  it(">30 条默认只渲染最近 30 条 + 折叠提示；展开后全量 + 收起按钮", async () => {
    mockTimeline.mockResolvedValue(respOf(35));
    renderCard();
    await screen.findByTestId("change-timeline-card");
    // 最早的 5 条被折叠
    expect(screen.queryByText("事件 1")).toBeNull();
    expect(screen.queryByText("事件 5")).toBeNull();
    expect(screen.getByText("事件 6")).toBeInTheDocument();
    expect(screen.getByText("事件 35")).toBeInTheDocument();
    expect(screen.getByTestId("change-timeline-expand")).toHaveTextContent("已折叠较早的 5 条事件");

    fireEvent.click(screen.getByTestId("change-timeline-expand"));
    expect(screen.getByText("事件 1")).toBeInTheDocument();
    expect(screen.getByTestId("change-timeline-collapse")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("change-timeline-collapse"));
    expect(screen.queryByText("事件 1")).toBeNull();
    expect(screen.getByText("事件 35")).toBeInTheDocument();
  });
});
