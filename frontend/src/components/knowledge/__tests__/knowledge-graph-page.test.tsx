/**
 * 知识图谱页测试（task-09 / 2026-10-08-platform-knowledge-graph / FR-05 / FR-06 /
 * D-006@v1 / D-008@v2）。
 *
 * 覆盖（task 卡 acceptance）：
 * 1. 三态：isPending 骨架 / unavailable 六键全文案（unbound 附绑定入口 href）/
 *    可用态渲染——首载自动发起 orphans 默认查询（D-006），top-50 清单 + count
 *    口径 + mode-chip「orphans · 孤儿节点」；
 * 2. lite↔切片状态机（D-008@v2 钉死）：胶囊手动切 lite（簇卡 + 代表行）→
 *    点代表自动切切片并以该节点发起 neighbors → 胶囊再回 lite；
 * 3. 锚点补全不可用（旧 CLI 信封 unavailable）→ 静默禁用（无候选无报错，
 *    D-005@v1 能力探测）；
 * 4. ?preset=dangling 深链首载按 preset 发起（ops 图卡清单行跳转目标）；
 * 5. entry 节点「在知识库打开」深链 href（?file=&anchor= 惯例）+ path 不可达
 *    reason 文案与强边寻路注记；summary=null 时 lite 胶囊隐藏主链路不受阻。
 *
 * 惯例（仿 ops-dashboard.test.tsx）：@/lib/knowledge 图三函数 hoisted mock +
 * QueryClientProvider retry:false/gcTime:0；next/navigation 走 navState 可覆写
 * （knowledge-page.test 同款）。画布交互（缩放/拾取）不可测面由
 * graph-canvas.test.ts 纯函数覆盖。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphOverview: vi.fn(),
  getKnowledgeGraphQuery: vi.fn(),
  getKnowledgeGraphNodes: vi.fn(),
}));
vi.mock("@/lib/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge")>()),
  getKnowledgeGraphOverview: mocks.getKnowledgeGraphOverview,
  getKnowledgeGraphQuery: mocks.getKnowledgeGraphQuery,
  getKnowledgeGraphNodes: mocks.getKnowledgeGraphNodes,
}));

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

  it("可用态：首载自动发起 orphans 默认查询（D-006）+ top-50 清单 + count 口径 + mode-chip", async () => {
    renderPage();
    // 缺省参数（edges=all/depth=1 → 不传，走 CLI 缺省）。
    await waitFor(() =>
      expect(mocks.getKnowledgeGraphQuery).toHaveBeenCalledWith(WS, "orphans", {
        anchor: undefined,
        anchor2: undefined,
        edges: undefined,
        depth: undefined,
      }),
    );
    expect(await screen.findByTestId("result-title")).toHaveTextContent("orphans · 1807 个孤儿");
    // top-50 清单渲染 + count 口径（count 1807 > items 50）。
    expect(screen.getAllByTestId("orphan-row")).toHaveLength(50);
    expect(screen.getByTestId("result-count-note")).toHaveTextContent("共 1807 条");
    expect(screen.getByTestId("result-count-note")).toHaveTextContent("top-50");
    // mode-chip 钉死「orphans · 孤儿节点」+ 引擎信息。
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("orphans · 孤儿节点");
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("力场");
    // 数据面 lite 胶囊（summary 非空）与查询切片胶囊齐备。
    expect(screen.getByTestId("mode-capsule-lite")).toBeInTheDocument();
    expect(screen.getByTestId("mode-capsule-slice")).toBeInTheDocument();
    // 等价 CLI 提示条（黑底等宽动态拼）。
    expect(screen.getByTestId("cli-hint")).toHaveTextContent(
      "sillyspec knowledge graph orphans --json",
    );
    // 图例：节点 10 类型 + 边 16 型三档。
    expect(screen.getAllByTestId(/^legend-node-/)).toHaveLength(10);
    expect(screen.getAllByTestId(/^legend-edge-/)).toHaveLength(16);
  });

  it("summary=null（旧 CLI）→ lite 胶囊隐藏，orphans 主链路不受阻", async () => {
    mocks.getKnowledgeGraphOverview.mockResolvedValue(overviewEnvelope({ summary: null }));
    renderPage();
    expect(await screen.findAllByTestId("orphan-row")).toHaveLength(50);
    expect(screen.queryByTestId("mode-capsule-lite")).not.toBeInTheDocument();
    expect(screen.getByTestId("mode-capsule-slice")).toBeInTheDocument();
  });
});

// ── lite ↔ 切片状态机 ───────────────────────────────────────────────────────

describe("lite↔切片状态机（D-008@v2）", () => {
  it("胶囊切 lite（簇卡+代表行）→ 点代表切切片并以其为锚点发起 neighbors → 胶囊回 lite", async () => {
    renderPage();
    await screen.findAllByTestId("orphan-row");

    // 手动切 lite：查询结果 tab 呈 lite 总览（簇卡 + 代表行），清单消失。
    fireEvent.click(screen.getByTestId("mode-capsule-lite"));
    expect(await screen.findAllByTestId("lite-cluster")).toHaveLength(2);
    const reps = screen.getAllByTestId("lite-rep-row");
    expect(reps).toHaveLength(2);
    expect(screen.getByTestId("graph-mode-chip")).toHaveTextContent("总览 lite");
    expect(screen.queryAllByTestId("orphan-row")).toHaveLength(0);

    // 点代表 → 自动切切片 + neighbors 以该节点为锚点发起。
    fireEvent.click(reps[0]!);
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
    expect(screen.queryByTestId("lite-cluster")).not.toBeInTheDocument();

    // 胶囊手动回 lite（状态机钉死：只有胶囊回 lite）。
    fireEvent.click(screen.getByTestId("mode-capsule-lite"));
    expect(await screen.findAllByTestId("lite-cluster")).toHaveLength(2);
  });
});

// ── 锚点补全 ────────────────────────────────────────────────────────────────

describe("锚点自动补全（D-005@v1）", () => {
  it("补全端点 unavailable（旧 CLI）→ 静默禁用：无候选下拉、无报错、页面不受阻", async () => {
    renderPage();
    await screen.findAllByTestId("orphan-row");
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
    await screen.findAllByTestId("orphan-row");
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
