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
 *   - 图维度卡三态（task-09 / 2026-10-08-platform-knowledge-graph 扩展 /
 *     FR-07 / D-004@v1）：正常计数 + 点开清单行深链 ?preset=；unavailable
 *     reason 六键引导文案；子块失败计数 null → 「—」。既有四卡断言零回归
 *     （图 overview/query 端点一并 mock，测试环境不再打真实 fetch）。
 *
 * 惯例（仿 distill-task-bar.test.tsx）：@/lib/knowledge 部分 mock
 * （vi.hoisted + importActual）+ QueryClientProvider retry:false/gcTime:0。
 */

import { within, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatPerTaskPct,
  OpsDashboard,
} from "@/components/knowledge/ops-dashboard";
import type { KnowledgeStatsOut } from "@/lib/knowledge";

const mocks = vi.hoisted(() => ({
  getKnowledgeStats: vi.fn(),
  getKnowledgeGraphOverview: vi.fn(),
  getKnowledgeGraphQuery: vi.fn(),
}));
vi.mock("@/lib/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge")>()),
  getKnowledgeStats: mocks.getKnowledgeStats,
  getKnowledgeGraphOverview: mocks.getKnowledgeGraphOverview,
  getKnowledgeGraphQuery: mocks.getKnowledgeGraphQuery,
}));

const WS = "ws-1";

/** stats fixture（字段对齐 task-01 生成的 KnowledgeStatsOut）。 */
function stats(p: Partial<KnowledgeStatsOut> = {}): KnowledgeStatsOut {
  return {
    coverage: {
      used_entries: 78,
      total_entries: 126,
      routable_entries: 90,
      routable_used_entries: 70,
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
    orphan_anchors: [
      { anchor: "conventions.md#esm-only", total: 525, last_hit: "2026-09-23T19:49:50Z" },
      { anchor: "known-issues.md#已换代小节", total: 12, last_hit: null },
    ],
    data_until: "2026-09-25T05:06:34Z",
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

/** 图 overview 信封 fixture（缺省可用 + 计数 3/5；summary 子块测试不依赖）。 */
function graphOverview(p: {
  available?: boolean;
  reason?: string | null;
  orphans_count?: number | null;
  dangling_count?: number | null;
} = {}) {
  const available = p.available ?? true;
  return {
    available,
    reason: p.reason ?? null,
    source: "daemon-rpc",
    data: available
      ? {
          summary: null,
          // null（子块失败）与缺省 3/5 是两个语义——显式区分，不用 ??。
          orphans_count: p.orphans_count !== undefined ? p.orphans_count : 3,
          dangling_count: p.dangling_count !== undefined ? p.dangling_count : 5,
        }
      : null,
  };
}

/** 图 orphans 清单 fixture（query 端点懒加载，点开清单才消费）。 */
function graphOrphansQuery() {
  return {
    available: true,
    reason: null,
    source: "daemon-rpc",
    data: {
      count: 3,
      items: [
        { id: "entry:uncategorized.md#老坑", type: "entry", kind: "zero-degree" },
        { id: "generated/runtime.md#死条目", type: "entry", kind: "entry-no-route-no-strong" },
      ],
    },
  };
}

/** 图 dangling 清单 fixture。 */
function graphDanglingQuery() {
  return {
    available: true,
    reason: null,
    source: "daemon-rpc",
    data: {
      count: 5,
      items: [
        { id: "doc:card:frontend", type: "doc-refs", kind: "medium", detail: "backend/build.sh" },
      ],
    },
  };
}

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
  // 图维度卡数据源缺省 mock（可用 + 计数 3/5）——既有四卡用例在图卡就绪
  // 环境下跑（零回归口径），图卡专属三态在下方 describe 内覆写。
  mocks.getKnowledgeGraphOverview.mockResolvedValue(graphOverview());
  mocks.getKnowledgeGraphQuery.mockImplementation(
    async (_ws: string, sub: string) =>
      sub === "dangling" ? graphDanglingQuery() : graphOrphansQuery(),
  );
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

  it("可路由口径为主数值 + 全集口径副显 + 数据截至 + 失效命中期开合（2026-09-25-knowledge-stats-layering）", async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard")).toBeInTheDocument(),
    );
    // 主数值 = 可路由口径 70/90 ≈ 78%；副显全集口径 78/126 ≈ 62%
    const coverage = screen.getByTestId("metric-coverage");
    expect(coverage).toHaveTextContent("78%");
    expect(coverage).toHaveTextContent("70/90 条");
    expect(coverage).toHaveTextContent("全集口径 62%（78/126 条，含不可路由桶）");
    // 数据截至时间随头部行展示
    expect(screen.getByTestId("ops-dashboard")).toHaveTextContent("数据截至");
    // 失效命中：默认收起，点开渲染清单行
    expect(screen.queryByTestId("orphan-entries-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("orphan-toggle"));
    const panel = await screen.findByTestId("orphan-entries-panel");
    const rows = within(panel).getAllByTestId("orphan-entry-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("conventions.md#esm-only");
    expect(rows[0]).toHaveTextContent("525 次");
    expect(rows[1]).toHaveTextContent("已换代小节");
    fireEvent.click(screen.getByTestId("orphan-toggle"));
    expect(screen.queryByTestId("orphan-entries-panel")).not.toBeInTheDocument();
  });

  it("点死条目卡展开清单（锚点 + 最后命中时间/从未），再点收起", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard")).toBeInTheDocument(),
    );

    // 初始收起。
    expect(screen.queryByTestId("dead-entries-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("metric-dead"));
    screen.getByTestId("dead-entries-panel");
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
        coverage: {
          used_entries: 0,
          total_entries: 0,
          routable_entries: 0,
          routable_used_entries: 0,
          trend: [],
        },
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

describe("图维度卡三态（task-09 扩展 / FR-07 / D-004@v1）", () => {
  it("可用态：孤儿/悬空计数 + 点开清单懒加载 + 行深链 ?preset=（既有四卡同帧零回归）", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("metric-graph-orphans")).toBeInTheDocument(),
    );
    // 图卡计数与 mock 一致（口径小注「知识图完整性」）。
    expect(screen.getByTestId("metric-graph-orphans")).toHaveTextContent("图·孤儿");
    expect(screen.getByTestId("metric-graph-orphans")).toHaveTextContent("3 条");
    expect(screen.getByTestId("metric-graph-dangling")).toHaveTextContent("5 条");

    // 既有四卡同帧零回归（图卡加入指标网格后原断言口径不变）。
    expect(screen.getByTestId("metric-coverage")).toHaveTextContent("78%");
    expect(screen.getByTestId("metric-dead")).toHaveTextContent("2 条");
    expect(screen.getByTestId("metric-density")).toHaveTextContent("4.2");
    expect(screen.getByTestId("metric-freshness")).toHaveTextContent("5/12");

    // 点开孤儿清单：懒加载 query 端点（此前零调用）+ 清单行深链图谱页 preset。
    expect(mocks.getKnowledgeGraphQuery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("metric-graph-orphans"));
    const panel = await screen.findByTestId("graph-orphans-panel");
    // 面板先以 pending 态挂载，清单行经懒加载落定。
    const rows = await within(panel).findAllByTestId("graph-orphans-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("entry:uncategorized.md#老坑");
    expect(rows[0]).toHaveAttribute(
      "href",
      `/workspaces/${WS}/knowledge/graph?preset=orphans`,
    );
    expect(rows[1]).toHaveAttribute(
      "href",
      `/workspaces/${WS}/knowledge/graph?preset=orphans`,
    );
    expect(mocks.getKnowledgeGraphQuery).toHaveBeenCalledWith(WS, "orphans");

    // 悬空清单同款（行含 kind 档与缺失目标）。
    fireEvent.click(screen.getByTestId("metric-graph-dangling"));
    const dpanel = await screen.findByTestId("graph-dangling-panel");
    const drows = await within(dpanel).findAllByTestId("graph-dangling-row");
    expect(drows).toHaveLength(1);
    expect(drows[0]).toHaveTextContent("doc:card:frontend");
    expect(drows[0]).toHaveAttribute(
      "href",
      `/workspaces/${WS}/knowledge/graph?preset=dangling`,
    );
  });

  it("unavailable：reason=unbound → 六键引导文案占卡（无计数、无清单）", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());
    mocks.getKnowledgeGraphOverview.mockResolvedValue(
      graphOverview({ available: false, reason: "unbound" }),
    );
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("metric-graph-orphans")).toHaveTextContent(
        "未绑定 daemon 运行时——绑定后可查看知识图完整性",
      ),
    );
    expect(screen.getByTestId("metric-graph-dangling")).toHaveTextContent(
      "未绑定 daemon 运行时——绑定后可查看知识图完整性",
    );
    // 不可用不渲染计数与清单入口（点开也不拉清单）。
    expect(screen.queryByText("3 条")).not.toBeInTheDocument();
    expect(screen.queryByTestId("graph-orphans-panel")).not.toBeInTheDocument();
  });

  it("子块失败计数 null → 「—」（overview 逐块容错，D-001@v2）", async () => {
    mocks.getKnowledgeStats.mockResolvedValue(stats());
    mocks.getKnowledgeGraphOverview.mockResolvedValue(
      graphOverview({ orphans_count: null, dangling_count: null }),
    );
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId("metric-graph-orphans")).toHaveTextContent("—"),
    );
    expect(screen.getByTestId("metric-graph-dangling")).toHaveTextContent("—");
  });
});
