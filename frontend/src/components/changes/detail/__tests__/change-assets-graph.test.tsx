/**
 * ChangeAssetsGraph 组件测试（2026-10-15-change-assets-graph / FR-01）。
 *
 * 覆盖：
 *   - 可用信封：渲染图谱分区（画布 stub 收到切片节点）+ 详情栏默认选中锚点
 *     变更节点（类型中文标签 + ID + 按边型分组出入邻居行）；
 *   - 交互：邻居行点击跳选（详情栏切到目标节点）+ 画布节点点击选中；
 *   - fail-open 三态：available=false / 请求失败 / 节点集为空 → 整区不渲染；
 *   - 加载中：轻提示占位。
 *
 * GraphCanvas 替身沿用 knowledge-graph-page.test.tsx 范式（jsdom 无 canvas 2D）：
 * 节点点击经代理按钮走 onSelect；纯函数导出保持原模块真身。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAssetsGraph } from "@/components/changes/detail/change-assets-graph";

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphQuery: vi.fn(),
}));

vi.mock("@/lib/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge")>();
  return { ...actual, getKnowledgeGraphQuery: mocks.getKnowledgeGraphQuery };
});

vi.mock("@/components/knowledge/graph-canvas", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/knowledge/graph-canvas")>();
  const GraphCanvasStub = (props: {
    nodes: ReadonlyArray<{ id: string }>;
    mode?: string;
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
  }) => (
    <div data-testid="graph-canvas" data-mode={props.mode ?? "slice"} data-selected={props.selectedId ?? ""}>
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

const ANCHOR = "2026-10-15-assets-demo";

function makeEnvelope(over?: {
  available?: boolean;
  nodes?: Array<{ id: string; type?: string; label?: string }>;
  edges?: Array<{ s: string; t: string; type: string; strength: string }>;
}) {
  const nodes = over?.nodes ?? [
    { id: ANCHOR, type: "change", label: "演示变更" },
    { id: "frontend/src/app/page.tsx", type: "file", label: "page.tsx" },
    { id: "decision:d.md#D-001@v1", type: "decision", label: "D-001@v1" },
  ];
  const edges = over?.edges ?? [
    { s: ANCHOR, t: "frontend/src/app/page.tsx", type: "deliverables", strength: "strong" },
    { s: "decision:d.md#D-001@v1", t: ANCHOR, type: "from-change", strength: "strong" },
  ];
  return {
    available: over?.available ?? true,
    reason: over?.available === false ? "upgrade_required" : null,
    data: over?.available === false ? null : { anchor: ANCHOR, nodes, edges },
  };
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeAssetsGraph workspaceId="ws-1" changeKey={ANCHOR} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getKnowledgeGraphQuery.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ChangeAssetsGraph（沉淀资产卡内嵌知识图谱分区）", () => {
  it("可用信封：渲染分区，画布收到切片节点，详情栏默认选中锚点变更节点（类型标签+ID+分组邻居行）", async () => {
    mocks.getKnowledgeGraphQuery.mockResolvedValue(makeEnvelope());
    renderCard();

    const section = await screen.findByTestId("change-assets-graph");
    expect(section).toBeInTheDocument();
    expect(mocks.getKnowledgeGraphQuery).toHaveBeenCalledWith(
      "ws-1",
      "neighbors",
      { anchor: ANCHOR, depth: 1 },
    );
    // 画布 stub 收到三节点切片（testid = canvas-node-<完整节点 id>）
    expect(
      screen.getByTestId("canvas-node-frontend/src/app/page.tsx"),
    ).toBeInTheDocument();
    // 详情栏默认锚点：label + 类型中文标签 + 邻居行（出 1 入 1，按边型分组）
    expect(screen.getByText("演示变更")).toBeInTheDocument();
    expect(screen.getByText("变更")).toBeInTheDocument();
    expect(screen.getByText("deliverables")).toBeInTheDocument();
    expect(screen.getByText("from-change")).toBeInTheDocument();
  });

  it("邻居行点击跳选：详情栏切到目标节点（画布点击同效）", async () => {
    mocks.getKnowledgeGraphQuery.mockResolvedValue(makeEnvelope());
    renderCard();

    // 邻居行（page.tsx，出方向）点击 → 详情栏切到该节点
    await screen.findByText("演示变更");
    fireEvent.click(screen.getByText("page.tsx"));
    await waitFor(() =>
      expect(screen.getByTestId("change-assets-graph-detail")).toHaveTextContent(
        "代码文件",
      ),
    );
    // 画布节点点击（decision 节点）→ 选中环同步 + 详情栏切到决策
    fireEvent.click(screen.getByTestId("canvas-node-decision:d.md#D-001@v1"));
    await waitFor(() =>
      expect(screen.getByTestId("change-assets-graph-detail")).toHaveTextContent(
        "D-001@v1",
      ),
    );
  });

  it("fail-open：available=false（upgrade_required）→ 整区不渲染", async () => {
    mocks.getKnowledgeGraphQuery.mockResolvedValue(makeEnvelope({ available: false }));
    renderCard();
    await waitFor(() =>
      expect(screen.queryByTestId("change-assets-graph-loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("change-assets-graph")).not.toBeInTheDocument();
  });

  it("fail-open：请求失败 → 整区不渲染（retry:false 不轰炸）", async () => {
    mocks.getKnowledgeGraphQuery.mockRejectedValue(new Error("rpc down"));
    renderCard();
    await waitFor(() =>
      expect(screen.queryByTestId("change-assets-graph-loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("change-assets-graph")).not.toBeInTheDocument();
  });

  it("fail-open：节点集为空 → 整区不渲染（锚点未命中降级形态）", async () => {
    mocks.getKnowledgeGraphQuery.mockResolvedValue(
      makeEnvelope({ nodes: [], edges: [] }),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.queryByTestId("change-assets-graph-loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("change-assets-graph")).not.toBeInTheDocument();
  });

  it("加载中：轻提示占位（不渲染分区主体）", () => {
    mocks.getKnowledgeGraphQuery.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByTestId("change-assets-graph-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-graph")).not.toBeInTheDocument();
  });

  // ── 层级选择器（2026-10-15-assets-graph-depth / FR-01~02）──────────────────

  it("层级选择器：默认 1 跳激活，点击 2跳/3跳 按所选深度重新发起 neighbors 查询（depth 进 query key）", async () => {
    mocks.getKnowledgeGraphQuery.mockResolvedValue(makeEnvelope());
    renderCard();

    await screen.findByTestId("change-assets-graph");
    // 默认激活 1 跳（aria-pressed），且首查 depth=1
    expect(screen.getByTestId("assets-graph-depth-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("assets-graph-depth-2")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // 切 2跳 → 以 depth=2 重新发起并激活；再切 3跳 同理
    fireEvent.click(screen.getByTestId("assets-graph-depth-2"));
    await waitFor(() =>
      expect(mocks.getKnowledgeGraphQuery).toHaveBeenLastCalledWith(
        "ws-1",
        "neighbors",
        { anchor: ANCHOR, depth: 2 },
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("assets-graph-depth-2")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    fireEvent.click(screen.getByTestId("assets-graph-depth-3"));
    await waitFor(() =>
      expect(mocks.getKnowledgeGraphQuery).toHaveBeenLastCalledWith(
        "ws-1",
        "neighbors",
        { anchor: ANCHOR, depth: 3 },
      ),
    );
  });

  it("层级切换不闪空：新深度查询在途时分区保持渲染上一份切片（keepPreviousData，无 loading 整区替换）", async () => {
    // 首查立即返回；第二查（depth=2）挂起不返回——切档后分区应仍渲染旧数据
    mocks.getKnowledgeGraphQuery.mockResolvedValueOnce(makeEnvelope());
    mocks.getKnowledgeGraphQuery.mockReturnValue(new Promise(() => {}));
    renderCard();

    await screen.findByTestId("change-assets-graph");
    fireEvent.click(screen.getByTestId("assets-graph-depth-2"));
    // 查询在途：分区主体保持（上一份切片渲染），loading 占位不出现
    await waitFor(() =>
      expect(screen.getByTestId("assets-graph-depth-2")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByTestId("change-assets-graph")).toBeInTheDocument();
    expect(
      screen.queryByTestId("change-assets-graph-loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("演示变更")).toBeInTheDocument();
  });
});
