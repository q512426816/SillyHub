/**
 * ScanDocsStatsPanel 组件测试（task-03 / 2026-09-21-scan-docs-ops-panel /
 * FR-03 / FR-04 / FR-07 / D-001~D-003@v1）。
 *
 * 依据：
 *   - frontend/src/components/scan-docs-stats-panel.tsx + 原型
 *     prototype-scan-docs-ops-panel.html 的四指标卡与双榜 tab 形态；
 *   - task-03 卡片 acceptance：综合覆盖率取整口径、陈旧清单开合、
 *     双榜 tab 切换、注入空态文案、三态占位不白屏。
 *
 * 惯例（仿 ops-dashboard.test.tsx + scan-docs-page.test.tsx）：
 * @/lib/scan-docs 部分 mock（vi.hoisted + importActual，fixture 直接用
 * task-02 生成类型 ScanDocsStats——编译期锁「无手写类型」）+
 * QueryClientProvider retry:false/gcTime:0 + ResizeObserver mock。
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ResizeObserver jsdom 缺失前置（scan-docs-page.test 同款）。
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

const mocks = vi.hoisted(() => ({ getScanDocsStats: vi.fn() }));
vi.mock("@/lib/scan-docs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scan-docs")>()),
  getScanDocsStats: mocks.getScanDocsStats,
}));

import { ScanDocsStatsPanel } from "@/components/scan-docs-stats-panel";
import type { ScanDocsStats } from "@/lib/scan-docs";

const WS = "ws-1";

/** stats fixture（字段对齐 task-02 生成的 ScanDocsStatsOut——openapi 类型，
 * 编译期无手写）。覆盖 50/70 → 71%（round）。 */
function stats(p: Partial<ScanDocsStats> = {}): ScanDocsStats {
  return {
    coverage: {
      std_have: 33,
      std_expected: 35,
      module_have: 17,
      module_expected: 35,
      trend: [
        { week: "2026-07-27", updated: 2 },
        { week: "2026-08-03", updated: 1 },
        { week: "2026-08-10", updated: 3 },
        { week: "2026-08-17", updated: 2 },
        { week: "2026-08-24", updated: 4 },
        { week: "2026-08-31", updated: 3 },
        { week: "2026-09-07", updated: 5 },
        { week: "2026-09-14", updated: 6 },
      ],
    },
    stale_docs: [
      // DB 原始形态：包裹布局带 .sillyspec/docs/ 前缀（展示时剥掉）。
      {
        path: ".sillyspec/docs/backend/scan/INTEGRATIONS.md",
        doc_type: "INTEGRATIONS",
        last_modified_at: "2026-03-14T12:00:00Z",
      },
      // 扁平布局带 docs/ 前缀 + 未知时间（null → 「未知」）。
      {
        path: "docs/frontend/modules/build.md",
        doc_type: "CONVENTIONS",
        last_modified_at: null,
      },
    ],
    density: { per_project_avg: 12.34 },
    freshness: { recent_updated: 63, total: 296 },
    recent_board: [
      {
        path: "docs/frontend/modules/scan-docs.md",
        doc_type: "CONVENTIONS",
        last_modified_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
      {
        path: ".sillyspec/docs/backend/modules/scan_docs.md",
        doc_type: "ARCHITECTURE",
        last_modified_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
    ],
    // injection.board 后端已剥前缀，直接展示。
    injection: {
      total_30d: 42,
      docs_hit_30d: 12,
      board: [
        { path: "backend/modules/scan_docs.md", hits_30d: 18 },
        { path: "frontend/modules/scan-docs.md", hits_30d: 7 },
      ],
    },
    ...p,
  };
}

let queryClient: QueryClient;

function renderPanel() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ScanDocsStatsPanel workspaceId={WS} />
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

describe("四指标卡渲染（FR-03）", () => {
  it("覆盖率（综合取整+两档明细+8 点趋势折线）/ 陈旧 / 密度 / 鲜活与 mock 一致", async () => {
    mocks.getScanDocsStats.mockResolvedValue(stats());

    renderPanel();

    // 主态锚点用数据才有的 testid（根 testid 加载态也带，会假性通过）。
    await waitFor(() =>
      expect(screen.getByTestId("metric-coverage")).toBeInTheDocument(),
    );
    expect(mocks.getScanDocsStats).toHaveBeenCalledWith(WS);

    // 覆盖率：(33+17)/(35+35) = 50/70 → 71%（round），两档明细齐备。
    const coverage = screen.getByTestId("metric-coverage");
    expect(coverage).toHaveTextContent("71%");
    expect(coverage).toHaveTextContent("50/70 项");
    expect(coverage).toHaveTextContent("七件套 33/35");
    expect(coverage).toHaveTextContent("模块文档 17/35");
    const polyline = screen
      .getByTestId("coverage-trend")
      .querySelector("polyline");
    expect(polyline).toBeTruthy();
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(8);

    // 陈旧：2 篇（90 天未更新）。
    expect(screen.getByTestId("metric-stale")).toHaveTextContent("2 篇");

    // 密度：12.3 篇/项目（toFixed(1)）。
    expect(screen.getByTestId("metric-density")).toHaveTextContent("12.3");
    expect(screen.getByTestId("metric-density")).toHaveTextContent("篇/项目");

    // 鲜活：63/296 篇。
    expect(screen.getByTestId("metric-freshness")).toHaveTextContent("63");
    expect(screen.getByTestId("metric-freshness")).toHaveTextContent("296");
  });
});

describe("陈旧清单开合（FR-03）", () => {
  it("点陈旧卡展开清单（剥前缀路径 + 最后修改/未知），再点收起", async () => {
    mocks.getScanDocsStats.mockResolvedValue(stats());
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("metric-stale")).toBeInTheDocument(),
    );

    // 初始收起。
    expect(screen.queryByTestId("stale-docs-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("metric-stale"));
    const panel = screen.getByTestId("stale-docs-panel");
    const rows = within(panel).getAllByTestId("stale-doc-row");
    expect(rows).toHaveLength(2);
    // 前缀剥掉（.sillyspec/docs/ 与 docs/ 两种布局同口径）；有日期 → YYYY-MM-DD。
    expect(rows[0]?.textContent).toContain("backend/scan/INTEGRATIONS.md");
    expect(rows[0]?.textContent).toContain("最后修改：2026-03-14");
    // 无时间 → 「未知」。
    expect(rows[1]?.textContent).toContain("frontend/modules/build.md");
    expect(rows[1]?.textContent).toContain("未知");

    // 再点收起。
    fireEvent.click(screen.getByTestId("metric-stale"));
    expect(screen.queryByTestId("stale-docs-panel")).not.toBeInTheDocument();
  });
});

describe("双榜 tab（FR-04 / FR-07 / D-003@v1）", () => {
  it("默认注入频次榜（头部小结 + 行 = 路径 + 次数），可切最近更新榜（相对时间）", async () => {
    mocks.getScanDocsStats.mockResolvedValue(stats());
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("injection-board")).toBeInTheDocument(),
    );

    // 默认注入榜：头部小结 + 两行（次数副显）。
    const injection = screen.getByTestId("injection-board");
    expect(screen.getByText("近 30 天 42 次 · 12 篇")).toBeInTheDocument();
    const injRows = within(injection).getAllByTestId("injection-board-row");
    expect(injRows).toHaveLength(2);
    expect(injRows[0]).toHaveTextContent("backend/modules/scan_docs.md");
    expect(injRows[0]).toHaveTextContent("18 次");
    expect(screen.queryByTestId("recent-board")).not.toBeInTheDocument();

    // 切「最近更新」：剥前缀路径 + 相对时间（小时级 / 天级）。
    fireEvent.click(screen.getByTestId("board-tab-recent"));
    const recent = screen.getByTestId("recent-board");
    expect(screen.queryByTestId("injection-board")).not.toBeInTheDocument();
    const rows = within(recent).getAllByTestId("recent-board-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("frontend/modules/scan-docs.md");
    expect(rows[0]).toHaveTextContent("2 小时前");
    expect(rows[1]).toHaveTextContent("backend/modules/scan_docs.md");
    expect(rows[1]).toHaveTextContent("3 天前");

    // 切回注入榜。
    fireEvent.click(screen.getByTestId("board-tab-injection"));
    expect(screen.getByTestId("injection-board")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-board")).not.toBeInTheDocument();
  });

  it("注入数据全零（total_30d=0，旧 CLI 未升级）→ 空态文案不报错", async () => {
    mocks.getScanDocsStats.mockResolvedValue(
      stats({ injection: { total_30d: 0, docs_hit_30d: 0, board: [] } }),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("injection-board")).toBeInTheDocument(),
    );
    expect(screen.getByText("暂无注入数据（CLI 升级后自动汇聚）")).toBeInTheDocument();
    expect(screen.queryAllByTestId("injection-board-row")).toHaveLength(0);
  });
});

describe("三态：加载 / 错误 / 空文档（不白屏，占住同版位）", () => {
  it("请求未决 → 「运营指标加载中…」", async () => {
    mocks.getScanDocsStats.mockImplementation(
      () => new Promise<ScanDocsStats>(() => {}),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("scan-docs-ops-panel-loading")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("scan-docs-ops-panel-loading")).toHaveTextContent(
      "运营指标加载中…",
    );
    expect(screen.queryByTestId("metric-coverage")).not.toBeInTheDocument();
  });

  it("请求失败 → 红条错误提示不白屏", async () => {
    mocks.getScanDocsStats.mockRejectedValue(new Error("网络错误"));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("scan-docs-ops-panel-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("scan-docs-ops-panel-error")).toHaveTextContent(
      "运营指标加载失败，请稍后刷新重试",
    );
  });

  it("无文档（freshness.total=0）→ 空态占位，不渲染指标卡与榜", async () => {
    mocks.getScanDocsStats.mockResolvedValue(
      stats({
        coverage: {
          std_have: 0,
          std_expected: 0,
          module_have: 0,
          module_expected: 0,
          trend: [],
        },
        stale_docs: [],
        density: { per_project_avg: 0 },
        freshness: { recent_updated: 0, total: 0 },
        recent_board: [],
        injection: { total_30d: 0, docs_hit_30d: 0, board: [] },
      }),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("scan-docs-ops-panel-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("scan-docs-ops-panel-empty")).toHaveTextContent(
      "暂无扫描文档",
    );
    expect(screen.queryByTestId("metric-coverage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("injection-board")).not.toBeInTheDocument();
  });
});
