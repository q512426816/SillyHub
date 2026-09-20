/**
 * OpsDashboard 组件测试（task-04 / 2026-09-20-knowledge-effect-panel /
 * FR-02 / FR-03 / D-009 / D-008@v3）。
 *
 * 依据：
 *   - frontend/src/components/knowledge/ops-dashboard.tsx + 原型
 *     prototype-effect-panel.html 的 .panel-grid 四指标卡与 Top 榜形态；
 *   - task-04 卡片 acceptance：四指标渲染与 mock 一致且死条目清单开合；
 *     榜按 per_task 降序且 % 格式阈值正确（0.0325 展示 3.25%、0.254 展示
 *     25.4%——D-008@v3 原文例值）；无数据空态与错误态不白屏。
 *
 * 惯例（仿 distill-task-bar.test.tsx）：@/lib/knowledge 部分 mock
 * （vi.hoisted + importActual）+ QueryClientProvider retry:false/gcTime:0。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatPerTaskPct,
  OpsDashboard,
} from "@/components/knowledge/ops-dashboard";
import type { KnowledgeStatsOut } from "@/lib/knowledge";

const mocks = vi.hoisted(() => ({ getKnowledgeStats: vi.fn() }));
vi.mock("@/lib/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge")>()),
  getKnowledgeStats: mocks.getKnowledgeStats,
}));

const WS = "ws-1";

/** stats fixture（字段对齐 task-01 生成的 KnowledgeStatsOut）。 */
function stats(p: Partial<KnowledgeStatsOut> = {}): KnowledgeStatsOut {
  return {
    coverage: {
      used_entries: 78,
      total_entries: 126,
      trend: [
        { week: "2026-07-26", pct: 0.4 },
        { week: "2026-08-02", pct: 0.45 },
        { week: "2026-08-09", pct: 0.5 },
        { week: "2026-08-16", pct: 0.5 },
        { week: "2026-08-23", pct: 0.55 },
        { week: "2026-08-30", pct: 0.57 },
        { week: "2026-09-06", pct: 0.6 },
        { week: "2026-09-13", pct: 0.62 },
      ],
    },
    dead_entries: [
      { anchor: "conventions.md#提交规范", last_hit_at: "2026-05-01T00:00:00Z" },
      { anchor: "decisions/backend.md", last_hit_at: null },
    ],
    density: { per_task_avg: 4.2, trend: [] },
    freshness: { recent_new: 12, recent_used: 5 },
    // 乱序喂入（0.92 在中间）：断言前端防御性 per_task 降序重排。
    usage_board: [
      {
        anchor: "conventions.md#backend-模块分层",
        per_task: 0.0325,
        total: 7,
        task_count: 3,
        first_hit: "2026-06-01T00:00:00Z",
        last_hit: "2026-09-10T00:00:00Z",
      },
      {
        anchor: "known-issues.md#docker-容器不热重载",
        per_task: 0.92,
        total: 342,
        task_count: 40,
        first_hit: "2026-01-01T00:00:00Z",
        last_hit: "2026-09-19T00:00:00Z",
      },
      {
        anchor: "decisions/frontend.md",
        per_task: 0.254,
        total: 61,
        task_count: 20,
        first_hit: "2026-02-01T00:00:00Z",
        last_hit: "2026-09-15T00:00:00Z",
      },
    ],
    entry_counts: [{ file: "known-issues.md", count: 400 }],
    ...p,
  };
}

let queryClient: QueryClient;

function renderDashboard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <OpsDashboard workspaceId={WS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("四指标卡渲染（FR-02 / D-009）", () => {
  it("覆盖率/死条目/密度/生效速度与 mock 一致 + 迷你周趋势折线渲染", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard")).toBeInTheDocument(),
    );
    expect(mocks.getKnowledgeStats).toHaveBeenCalledWith(WS);

    // 覆盖率：78/126 → 62%（round），分数字段与趋势折线齐备。
    const coverage = screen.getByTestId("metric-coverage");
    expect(coverage).toHaveTextContent("62%");
    expect(coverage).toHaveTextContent("78/126 条");
    const polyline = screen
      .getByTestId("coverage-trend")
      .querySelector("polyline");
    expect(polyline).toBeTruthy();
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(8);

    // 死条目：2 条（90 天零命中）。
    expect(screen.getByTestId("metric-dead")).toHaveTextContent("2 条");

    // 密度：4.2 条/任务。
    expect(screen.getByTestId("metric-density")).toHaveTextContent("4.2");
    expect(screen.getByTestId("metric-density")).toHaveTextContent("条/任务");

    // 生效速度：5/12（近 30 天新增中被用）。
    expect(screen.getByTestId("metric-freshness")).toHaveTextContent("5/12");
  });
});

describe("死条目内嵌清单开合", () => {
  it("点死条目卡展开清单（锚点 + 最后命中时间/从未），再点收起", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard")).toBeInTheDocument(),
    );

    // 初始收起。
    expect(screen.queryByTestId("dead-entries-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("metric-dead"));
    const panel = screen.getByTestId("dead-entries-panel");
    const rows = screen.getAllByTestId("dead-entry-row");
    expect(rows).toHaveLength(2);
    // 有最后命中 → 本地化日期（含年份）；无命中 → 「从未」。
    expect(rows[0]?.textContent).toContain("conventions.md#提交规范");
    expect(rows[0]?.textContent).toMatch(/2026/);
    expect(rows[1]?.textContent).toContain("decisions/backend.md");
    expect(rows[1]?.textContent).toContain("从未");

    // 再点收起。
    fireEvent.click(screen.getByTestId("metric-dead"));
    expect(screen.queryByTestId("dead-entries-panel")).not.toBeInTheDocument();
  });
});

describe("使用率榜（FR-03 / D-008@v3）", () => {
  it("按 per_task 降序渲染 + 两档 % 格式（0.0325→3.25%、0.254→25.4%）+ 绝对次数副显", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByTestId("usage-board")).toBeInTheDocument(),
    );

    const rows = screen.getAllByTestId("usage-board-row");
    expect(rows).toHaveLength(3);
    // 降序：0.92（known-issues）→ 0.254（decisions/frontend）→ 0.0325（分层）。
    expect(rows[0]).toHaveTextContent("known-issues.md#docker-容器不热重载");
    expect(rows[1]).toHaveTextContent("decisions/frontend.md");
    expect(rows[2]).toHaveTextContent("conventions.md#backend-模块分层");

    // 两档 % 格式（D-008@v3 阈值：<10 两位小数、≥10 一位小数）。
    expect(rows[0]).toHaveTextContent("92.0%");
    expect(rows[1]).toHaveTextContent("25.4%");
    expect(rows[2]).toHaveTextContent("3.25%");

    // 绝对次数副显。
    expect(rows[0]).toHaveTextContent("（342 次）");
    expect(rows[2]).toHaveTextContent("（7 次）");
  });

  it("formatPerTaskPct 阈值边界：<10 两位小数，≥10 一位小数", () => {
    // D-008@v3 例值：3.25% / 25.4%（task 卡断言 0.0325→3.25%、0.254→25.4%）。
    expect(formatPerTaskPct(0.0325)).toBe("3.25%");
    expect(formatPerTaskPct(0.254)).toBe("25.4%");
    // 边界：恰 10% 走一位小数档；9.99% 走两位小数档。
    expect(formatPerTaskPct(0.1)).toBe("10.0%");
    expect(formatPerTaskPct(0.0999)).toBe("9.99%");
  });
});

describe("三态：空态 / 错误态（不白屏）", () => {
  it("零使用指标 → 「暂无使用数据」空态，不渲染指标卡与榜", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(
      stats({
        coverage: { used_entries: 0, total_entries: 0, trend: [] },
        dead_entries: [],
        density: { per_task_avg: 0, trend: [] },
        freshness: { recent_new: 0, recent_used: 0 },
        usage_board: [],
        entry_counts: [],
      }),
    );
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ops-dashboard-empty")).toHaveTextContent(
      "暂无使用数据",
    );
    expect(screen.queryByTestId("metric-coverage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("usage-board")).not.toBeInTheDocument();
  });

  it("请求失败 → 错误提示不白屏", async () => {
    mocks.getKnowledgeStats.mockRejectedValue(new Error("网络错误"));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ops-dashboard-error")).toHaveTextContent(
      "运营指标加载失败",
    );
  });
});
