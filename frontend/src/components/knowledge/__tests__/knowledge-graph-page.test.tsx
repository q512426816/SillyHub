/**
 * 知识图谱页测试（task-09 / 2026-10-08-platform-knowledge-graph / FR-05 / FR-06 /
 * D-006@v1 / D-008@v2；全图默认视图组 task-06 / 2026-10-09-knowledge-graph-fullmap /
 * FR-04 / D-001@v1 / D-002@v1）。
 *
 * 覆盖（task 卡 acceptance）：
 * 1. 三态：isPending 骨架 / unavailable 六键全文案（unbound 附绑定入口 href）/
 *    可用态默认加载 dump 渲染全图（不发 orphans）——mode-chip「全图 N 节点 ·
 *    静态」+ 右栏图统计卡（四计数/类型分布）+ 胶囊两态 + CLI 提示条 dump 命令；
 * 2. 回退链（task-06）：dump upgrade_required / available=false → 全图胶囊
 *    隐藏 + 自动回退既有 orphans 默认链（top-50 清单 + count 口径）；
 * 3. 全图↔切片状态机：点全图节点 → 切切片并以该节点 id 发起 neighbors →
 *    胶囊手动回全图；
 * 4. 锚点补全不可用（旧 CLI 信封 unavailable）→ 静默禁用（无候选无报错，
 *    D-005@v1 能力探测）；
 * 5. ?preset=dangling 深链首载按 preset 发起（显式深链优先于全图默认；ops
 *    图卡清单行跳转目标）；entry 节点「在知识库打开」深链 href（?file=&anchor=
 *    惯例）+ path 不可达 reason 文案与强边寻路注记。
 *
 * 惯例（仿 ops-dashboard.test.tsx）：@/lib/knowledge 图四函数 hoisted mock +
 * QueryClientProvider retry:false/gcTime:0；next/navigation 走 navState 可覆写
 *（knowledge-page.test 同款）。GraphCanvas 以轻量 stub 替身（保留 graph-canvas
 * testid + 每节点一个代理按钮触发 onSelect + data-mode 暴露当前模式）——画布
 * 内部力场/绘制由 graph-canvas.test.ts 纯函数覆盖，本文件只测页面状态机。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphOverview: vi.fn(),
  getKnowledgeGraphQuery: vi.fn(),
  getKnowledgeGraphNodes: vi.fn(),
  getKnowledgeGraphDump: vi.fn(),
}));
vi.mock("@/lib/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge")>()),
  getKnowledgeGraphOverview: mocks.getKnowledgeGraphOverview,
  getKnowledgeGraphQuery: mocks.getKnowledgeGraphQuery,
  getKnowledgeGraphNodes: mocks.getKnowledgeGraphNodes,
  getKnowledgeGraphDump: mocks.getKnowledgeGraphDump,
}));

// GraphCanvas 替身：jsdom 无 canvas 2D 上下文，节点点击经代理按钮走 onSelect
//（页面状态机消费面）；data-mode 暴露当前模式供全图/切片断言。纯函数导出
//（NODE_TYPE_ORDER/edgeDash 等）保持原模块真身（importOriginal 展开）。
vi.mock("@/components/knowledge/graph-canvas", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/knowledge/graph-canvas")>();
  const GraphCanvasStub = (props: {
    nodes: ReadonlyArray<{ id: string }>;
    mode?: string;
    onSelect?: (id: string | null) => void;
  }) => (
    <div data-testid="graph-canvas" data-mode={props.mode ?? "slice"}>
      {props.nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          data-testid={`canvas-node-${n.id}`}
          onClick={() => props.onSelect?.(n.id)}
        />
      ))}
    </div>
  );
  return { ...original, GraphCanvas: GraphCanvasStub };
});

// useSearchParams 经 navState 可覆写（?preset= 深链用例）；usePathname 供
// 可能挂载的链接组件消费。
const navState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspaces/ws-1/knowledge/graph",
  useSearchParams: () => navState.searchParams,
}));

import KnowledgeGraphPage from "@/app/(dashboard)/workspaces/[id]/knowledge/graph/page";

const WS = "ws-1";

// ── fixture（形状对齐 api-types 生成 DTO；后端 schema.py 为真相源）─────────

function summaryFixture() {
  return {
    nodes: 4628,
    edges: 8210,
    by_type: { file: 4000, decision: 120, fr: 88, entry: 420 },
    by_edge: { anchors: 900, route: 260 },
    orphans: 1807,
    module_doc_gaps: 3,
    changelog_danglings: 5,
    dangling_refs: 7,
    clusters: [
      {
        key: "file:frontend",
        label: "代码文件 · frontend",
        count: 420,
        representatives: [
          { id: "frontend/src/lib/knowledge.ts", type: "file", label: "knowledge.ts" },
        ],
      },
      {
        key: "decision:backend",
        label: "决策 · backend",
        count: 60,
        representatives: [
          {
            id: "decision:decisions/daemon.md#D-001@v1",
            type: "decision",
            label: "D-001@v1",
          },
        ],
      },
    ],
  };
}

function overviewEnvelope(p: {
  available?: boolean;
  reason?: string | null;
  summary?: ReturnType<typeof summaryFixture> | null;
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
          summary: p.summary === undefined ? summaryFixture() : p.summary,
          orphans_count: p.orphans_count ?? 2,
          dangling_count: p.dangling_count ?? 3,
        }
      : null,
  };
}

/** orphans：count 1807 / items 50（首条 entry 锚点供深链用例）。 */
function orphansEnvelope() {
  const items = [
    { id: "known-issues.md#docker-fix", type: "entry", kind: "zero-degree" },
    ...Array.from({ length: 49 }, (_, i) => ({
      id: `entry:uncategorized.md#u-${i}`,
      type: "entry",
      kind: "entry-no-route-no-strong",
    })),
  ];
  return { available: true, reason: null, source: "daemon-rpc", data: { count: 1807, items } };
}

const neighborsEnvelope = {
  available: true,
  reason: null,
  source: "daemon-rpc",
  data: {
    anchor: "frontend/src/lib/knowledge.ts",
    nodes: [
      { id: "frontend/src/lib/knowledge.ts", type: "file", label: "knowledge.ts" },
      { id: "frontend", type: "module", label: "frontend" },
      { id: "known-issues.md#docker-fix", type: "entry", label: "docker 容器不热重载" },
    ],
    edges: [
      {
        s: "frontend/src/lib/knowledge.ts",
        t: "frontend",
        type: "module-files",
        strength: "strong",
      },
      {
        s: "known-issues.md#docker-fix",
        t: "frontend/src/lib/knowledge.ts",
        type: "doc-refs",
        strength: "medium",
      },
    ],
  },
};

const danglingEnvelope = {
  available: true,
  reason: null,
  source: "daemon-rpc",
  data: {
    count: 4,
    items: [
      { id: "doc:card:frontend", type: "doc-refs", kind: "medium", detail: "backend/build.sh" },
      { id: "doc:scan:CONV", type: "scan-refs", kind: "medium", detail: "docs/missing.md" },
    ],
  },
};

/** dump 信封（task-06）：stats 与 summary 同源聚合；节点带 CLI 预计算 x/y。 */
function dumpEnvelope(p: { available?: boolean; reason?: string | null } = {}) {
  const available = p.available ?? true;
  return {
    available,
    reason: p.reason ?? null,
    source: "daemon-rpc",
    data: available
      ? {
          nodes: [
            { id: "frontend", type: "module", label: "frontend", x: -320.0, y: 160.0 },
            {
              id: "frontend/src/lib/knowledge.ts",
              type: "file",
              label: "knowledge.ts",
              x: 64.0,
              y: -128.0,
            },
            {
              id: "decision:decisions/daemon.md#D-001@v1",
              type: "decision",
              label: "D-001@v1",
              x: 192.0,
              y: 320.0,
            },
          ],
          edges: [
            {
              s: "frontend/src/lib/knowledge.ts",
              t: "frontend",
              type: "module-files",
              strength: "strong",
            },
          ],
          stats: {
            nodes: 4628,
            edges: 8210,
            by_type: { file: 4000, entry: 420, decision: 120, fr: 88 },
            by_edge: { anchors: 900, route: 260 },
            orphans: 1807,
            module_doc_gaps: 3,
            changelog_danglings: 5,
            dangling_refs: 7,
            clusters: [],
          },
        }
      : null,
  };
}

const pathUnreachableEnvelope = {
  available: true,
  reason: null,
  source: "daemon-rpc",
  data: {
    from: "decision:decisions/unmapped.md#D-002@v1",
    to: "frontend",
    found: false,
    reason: "起点与终点在强边子集上不连通",
    hop_count: 0,
    hops: [],
  },
};

let queryClient: QueryClient;

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeGraphPage params={{ id: WS }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navState.searchParams = new URLSearchParams();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mocks.getKnowledgeGraphOverview.mockResolvedValue(overviewEnvelope());
  mocks.getKnowledgeGraphDump.mockResolvedValue(dumpEnvelope());
  mocks.getKnowledgeGraphQuery.mockImplementation(
    async (_ws: string, sub: string, _params?: unknown) => {
      if (sub === "neighbors") return neighborsEnvelope;
      if (sub === "dangling") return danglingEnvelope;
      if (sub === "path") return pathUnreachableEnvelope;
      return orphansEnvelope();
    },
  );
  mocks.getKnowledgeGraphNodes.mockResolvedValue({
    available: true,
    reason: null,
    source: "daemon-rpc",
    data: {
      nodes: [{ id: "FR-core-engine-001", type: "fr", label: "FR-core-engine-001" }],
    },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

// ── 三态 ────────────────────────────────────────────────────────────────────

describe("页面三态（D-001@v2 / D-006@v1）", () => {
  it("isPending → 全页骨架（不渲染三栏）", () => {
    mocks.getKnowledgeGraphOverview.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("graph-page-loading")).toHaveTextContent("知识图数据加载中…");
    expect(screen.queryByTestId("graph-canvas")).not.toBeInTheDocument();
  });

  it.each([
    ["unbound", "未绑定 daemon 运行时——绑定后可查看知识图完整性"],
    ["offline", "daemon 离线，稍后再试"],
    ["timeout", "知识图查询超时，稍后再试"],
    ["upgrade_required", "daemon 或 sillyspec CLI 版本过旧，升级后可查看"],
    ["invalid_input", "查询参数有误"],
    ["rpc_error", "知识图服务异常，稍后再试"],
  ])("unavailable reason=%s → 全页降级卡六键文案", async (reason, text) => {
    mocks.getKnowledgeGraphOverview.mockResolvedValue(
      overviewEnvelope({ available: false, reason }),
    );
    renderPage();
    const card = await screen.findByTestId("graph-page-unavailable");
    expect(card).toHaveTextContent("知识图暂不可用");
    expect(screen.getByTestId("graph-unavailable-reason")).toHaveTextContent(text);
    // 不可用不发起默认查询（整页降级）。
    expect(mocks.getKnowledgeGraphQuery).not.toHaveBeenCalled();
  });

  it("unbound 附绑定引导入口（runtime 页）", async () => {
    mocks.getKnowledgeGraphOverview.mockResolvedValue(
      overviewEnvelope({ available: false, reason: "unbound" }),
    );
    renderPage();
    expect(await screen.findByTestId("graph-unbound-link")).toHaveAttribute(
      "href",
      `/workspaces/${WS}/runtime`,
    );
  });

  it("可用态：首载加载 dump 渲染全图（task-06 / D-002@v1）——不发 orphans + 统计卡 + 胶囊两态 + dump 命令", async () => {
    renderPage();
    await waitFor(() => expect(mocks.getKnowledgeGraphDump).toHaveBeenCalledWith(WS));
    // 全图为默认视图：不触发 orphans 回退查询。
    expect(mocks.getKnowledgeGraphQuery).not.toHaveBeenCalled();
    // 画布处于 full 模式（stub 暴露 data-mode）。
    expect(await screen.findByTestId("graph-canvas")).toHaveAttribute("data-mode", "full");
    // mode-chip「全图 N 节点 · 静态」。
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("全图 4628 节点 · 静态");
    // 右栏图统计卡：节点/边总量 + 治理四计数 + 类型分布（by_type 降序前几）。
    expect(screen.getByTestId("result-title")).toHaveTextContent("全图 · 4628 节点 · 8210 边");
    const stats = screen.getByTestId("full-stats");
    expect(stats).toHaveTextContent("孤儿 1807");
    expect(stats).toHaveTextContent("模块文档缺口 3");
    expect(stats).toHaveTextContent("changelog 悬空 5");
    expect(stats).toHaveTextContent("悬空引用 7");
    const byType = within(stats).getAllByTestId("full-stats-bytype");
    expect(byType).toHaveLength(4); // fixture 四类型（top-6 截断内全显）
    expect(byType[0]).toHaveTextContent("file"); // count 降序
    expect(within(stats).getByText(/点击画布节点/)).toBeInTheDocument();
    // 胶囊两态：全图按下、查询切片待选。
    expect(screen.getByTestId("mode-capsule-full")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-capsule-slice")).toHaveAttribute("aria-pressed", "false");
    // 等价 CLI 提示条 full 态为 dump 命令。
    expect(screen.getByTestId("cli-hint")).toHaveTextContent(
      "sillyspec knowledge graph dump --layout",
    );
    // 图例：节点 10 类型 + 边 16 型三档。
    expect(screen.getAllByTestId(/^legend-node-/)).toHaveLength(10);
    expect(screen.getAllByTestId(/^legend-edge-/)).toHaveLength(16);
  });

  it("dump 不可用（upgrade_required）→ 全图胶囊隐藏 + 回退既有 orphans 默认链（D-006）", async () => {
    mocks.getKnowledgeGraphDump.mockResolvedValue(
      dumpEnvelope({ available: false, reason: "upgrade_required" }),
    );
    renderPage();
    // 回退链：自动发起 orphans（缺省参数——edges=all/depth=1 不传走 CLI 缺省）。
    await waitFor(() =>
      expect(mocks.getKnowledgeGraphQuery).toHaveBeenCalledWith(WS, "orphans", {
        anchor: undefined,
        anchor2: undefined,
        edges: undefined,
        depth: undefined,
      }),
    );
    // top-50 清单 + count 口径（count 1807 > items 50）。
    expect(await screen.findByTestId("result-title")).toHaveTextContent("orphans · 1807 个孤儿");
    expect(screen.getAllByTestId("orphan-row")).toHaveLength(50);
    expect(screen.getByTestId("result-count-note")).toHaveTextContent("共 1807 条");
    expect(screen.getByTestId("result-count-note")).toHaveTextContent("top-50");
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("orphans · 孤儿节点");
    // 全图胶囊隐藏（dump 不可用），切片胶囊独占且按下。
    expect(screen.queryByTestId("mode-capsule-full")).not.toBeInTheDocument();
    expect(screen.getByTestId("mode-capsule-slice")).toHaveAttribute("aria-pressed", "true");
  });

  it("overview summary=null（旧 CLI）→ 全图主链路不受阻（dump 独立于 overview summary）", async () => {
    mocks.getKnowledgeGraphOverview.mockResolvedValue(overviewEnvelope({ summary: null }));
    renderPage();
    expect(await screen.findByTestId("full-stats")).toBeInTheDocument();
    expect(screen.getByTestId("mode-capsule-full")).toBeInTheDocument();
    expect(mocks.getKnowledgeGraphQuery).not.toHaveBeenCalled();
  });
});

// ── 全图 ↔ 切片状态机 ───────────────────────────────────────────────────────

describe("全图↔切片状态机（task-06）", () => {
  it("点全图节点 → 切切片并以该节点为锚点发起 neighbors → 胶囊手动回全图", async () => {
    renderPage();
    await screen.findByTestId("full-stats");

    // 点全图节点（stub 代理按钮）→ 自动切切片 + neighbors 以该节点 id 为锚点发起。
    fireEvent.click(screen.getByTestId("canvas-node-frontend/src/lib/knowledge.ts"));
    await waitFor(() =>
      expect(mocks.getKnowledgeGraphQuery).toHaveBeenLastCalledWith(
        WS,
        "neighbors",
        expect.objectContaining({ anchor: "frontend/src/lib/knowledge.ts" }),
      ),
    );
    expect(await screen.findByTestId("result-title")).toHaveTextContent(
      "neighbors · knowledge.ts",
    );
    expect(screen.getByTestId("graph-canvas")).toHaveAttribute("data-mode", "slice");
    expect(screen.getByTestId("mode-capsule-full")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("mode-capsule-slice")).toHaveAttribute("aria-pressed", "true");

    // 胶囊手动回全图（状态机钉死：只有胶囊回全图）。
    fireEvent.click(screen.getByTestId("mode-capsule-full"));
    expect(await screen.findByTestId("full-stats")).toBeInTheDocument();
    expect(screen.getByTestId("graph-canvas")).toHaveAttribute("data-mode", "full");
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("全图 4628 节点 · 静态");
  });
});

// ── 锚点补全 ────────────────────────────────────────────────────────────────

describe("锚点自动补全（D-005@v1）", () => {
  it("补全端点 unavailable（旧 CLI）→ 静默禁用：无候选下拉、无报错、页面不受阻", async () => {
    renderPage();
    await screen.findByTestId("full-stats");
    mocks.getKnowledgeGraphNodes.mockResolvedValue({
      available: false,
      reason: "upgrade_required",
      source: "daemon-rpc",
      data: null,
    });

    fireEvent.change(await screen.findByTestId("anchor-input"), {
      target: { value: "known" },
    });
    // debounce 300ms 后发起（waitFor 轮询覆盖真实计时）。
    await waitFor(
      () => expect(mocks.getKnowledgeGraphNodes).toHaveBeenCalledWith(WS, "known", 8),
      { timeout: 4000 },
    );
    // 静默：无候选、无错误文案；页面其余面照常。
    expect(screen.queryAllByTestId("anchor-option")).toHaveLength(0);
    expect(screen.getByTestId("cli-hint")).toBeInTheDocument();
    expect(screen.getByTestId("result-title")).toBeInTheDocument();
  });
});

// ── 查询交互优化（2026-10-09-graph-query-ux）────────────────────────────────

describe("锚点自动选中与 sub 人话说明（2026-10-09-graph-query-ux）", () => {
  it("带锚点的 neighbors 查询执行后，锚点节点自动选中（右栏直切详情）", async () => {
    renderPage();
    await screen.findByTestId("full-stats");
    // 预置「文件反查」= neighbors + 真实锚点现成形态（跳过 antd Select 交互）。
    const presets = screen.getAllByTestId("preset-btn");
    const fileLookup = presets.find((b) => b.textContent?.includes("文件反查"));
    expect(fileLookup).toBeTruthy();
    fireEvent.click(fileLookup!);
    // 右栏自动切「节点详情」且展示锚点节点（自动选中，无需手点画布）。
    const detail = await screen.findByText("knowledge.ts");
    expect(detail).toBeInTheDocument();
    expect(mocks.getKnowledgeGraphQuery).toHaveBeenLastCalledWith(
      WS,
      "neighbors",
      expect.objectContaining({ anchor: "frontend/src/lib/knowledge.ts" }),
    );
  });

  it("sub 下拉下方动态说明行随选中类型切换（人话文案）", async () => {
    renderPage();
    await screen.findByTestId("full-stats");
    const desc = screen.getByTestId("sub-description");
    // 切到切片态默认 orphans → 孤儿节点说明。
    fireEvent.click(screen.getByTestId("mode-capsule-slice"));
    expect(desc).toHaveTextContent("没人理");
  });
});

// ── 深链与查询面 ────────────────────────────────────────────────────────────

describe("深链与查询面", () => {
  it("?preset=dangling 首载按 preset 发起（ops 图卡清单行跳转目标）", async () => {
    navState.searchParams = new URLSearchParams("preset=dangling");
    renderPage();
    await waitFor(() =>
      expect(mocks.getKnowledgeGraphQuery).toHaveBeenCalledWith(
        WS,
        "dangling",
        expect.anything(),
      ),
    );
    expect(await screen.findByTestId("result-title")).toHaveTextContent("dangling · 4 处悬空");
    const rows = screen.getAllByTestId("dangling-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("doc:card:frontend");
    expect(rows[0]).toHaveTextContent("缺失目标：backend/build.sh");
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("dangling · 悬空引用");
  });

  it("entry 节点：点孤儿清单行选中 → 详情 tab「在知识库打开」深链 ?file=&anchor=", async () => {
    // 显式 orphans 深链（全图为默认视图，孤儿清单需显式 preset 进切片）。
    navState.searchParams = new URLSearchParams("preset=orphans");
    renderPage();
    const rows = await screen.findAllByTestId("orphan-row");
    fireEvent.click(rows[0]!); // known-issues.md#docker-fix（entry）
    const link = await screen.findByTestId("open-in-knowledge");
    expect(link).toHaveAttribute(
      "href",
      `/workspaces/${WS}/knowledge?file=known-issues.md&anchor=docker-fix`,
    );
    // 详情 tab：类型 chip（手册条目）+ 节点 id kv。
    const panel = link.closest("div");
    expect(panel).toBeTruthy();
    expect(within(panel as HTMLElement).getAllByText("手册条目").length).toBeGreaterThan(0);
  });

  it("path 预置演示：不可达 → reason 文案 + 强边子集寻路注记", async () => {
    renderPage();
    await screen.findByTestId("full-stats");
    const presetBtn = screen
      .getAllByTestId("preset-btn")
      .find((el) => el.textContent?.includes("path"));
    expect(presetBtn).toBeTruthy();
    fireEvent.click(presetBtn!);
    expect(await screen.findByTestId("result-title")).toHaveTextContent("path · 不可达");
    expect(screen.getByText("起点与终点在强边子集上不连通")).toBeInTheDocument();
    expect(screen.getByText(/寻路仅在强边子集上进行/)).toBeInTheDocument();
    // 预置点击同步 draft → CLI 提示条带 path 与引号包裹锚点。
    expect(screen.getByTestId("cli-hint").textContent).toContain(
      'path "decision:decisions/unmapped.md#D-002@v1"',
    );
  });
});
