/**
 * scan-docs 页面测试（ql-20260821-013-2c1a 左树 antd Tree 化后补）。
 *
 * 覆盖：
 * 1. 文档树渲染：目录/文件行 + FileNodeIcon 按扩展名分型（.md → lucide-file-text）+ 徽标
 * 2. 点击文件行 → getScanDoc(workspaceId, id) 拉详情并展示标题
 * 3. 树栏拖拽把手：默认 280px，拖动调宽 + localStorage 记忆
 */

import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// antd Tree / rc-component resize-observer 需要 ResizeObserver，jsdom 缺，补 mock
// （file-explorer.test 同款前置）。
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

vi.mock("@/lib/scan-docs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan-docs")>();
  return {
    ...actual,
    listScanDocs: vi.fn(),
    reparseScanDocs: vi.fn(),
    getScanDoc: vi.fn(),
    // task-03：顶部运营面板消费的 stats 端点（真实请求会打 jsdom 缺失的
    // fetch；缺省全零 stats = 空态占位）。
    getScanDocsStats: vi.fn(),
  };
});

vi.mock("@/lib/workspace-binding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-binding")>();
  return {
    ...actual,
    fetchMyBinding: vi.fn(),
    canBorrowSharedDaemon: vi.fn(() => false),
  };
});

vi.mock("@/stores/session", () => ({
  useSession: (sel: (_s: unknown) => unknown) =>
    sel({ user: { permissions: [], is_platform_admin: false } }),
}));

// MarkdownPreview 是 dynamic(ssr:false) 异步组件，直接替换为静态渲染避免测试环境异步挂载。
vi.mock("@uiw/react-markdown-preview", () => ({
  default: ({ source }: { source?: string }) => <div data-testid="md-preview">{source}</div>,
}));

import ScanDocsPage from "@/app/(dashboard)/workspaces/[id]/scan-docs/page";
import { getScanDoc, getScanDocsStats, listScanDocs, reparseScanDocs } from "@/lib/scan-docs";
import { fetchMyBinding } from "@/lib/workspace-binding";

const mockList = listScanDocs as unknown as ReturnType<typeof vi.fn>;
const mockReparse = reparseScanDocs as unknown as ReturnType<typeof vi.fn>;
const mockGetDoc = getScanDoc as unknown as ReturnType<typeof vi.fn>;
const mockStats = getScanDocsStats as unknown as ReturnType<typeof vi.fn>;
const mockBinding = fetchMyBinding as unknown as ReturnType<typeof vi.fn>;

const WS = "ws-1";

function summary(partial: Partial<Record<string, unknown>> & { id: string; path: string }) {
  return {
    workspace_id: WS,
    doc_type: "design",
    title: null,
    exists: true,
    conflict_count: 0,
    ...partial,
  };
}

/** 默认两条：目录 backend/ 下一个 ARCHITECTURE.md + 根层 README.md。 */
function mockDefaultDocs() {
  mockList.mockResolvedValue({
    items: [
      summary({ id: "id-arch", path: "backend/ARCHITECTURE.md", doc_type: "scan" }),
      summary({ id: "id-readme", path: "README.md", source_member_id: "member-12345678" }),
    ],
  });
}

/** jsdom 无 PointerEvent，fireEvent.pointer* 带不上坐标：createEvent 后手工补属性再派发。 */
function firePointer(
  el: Element | Window,
  name: "pointerDown" | "pointerMove" | "pointerUp",
  init: { clientX?: number } = {},
) {
  const ev = createEvent[name](el as Element, init);
  for (const [k, v] of Object.entries(init)) {
    Object.defineProperty(ev, k, { value: v });
  }
  fireEvent(el, ev);
}

/** 等 reparse + 列表落定、树渲染完成。 */
async function waitForTree(names: string[]) {
  await waitFor(() => {
    for (const n of names) expect(screen.getByText(n)).toBeInTheDocument();
  });
}

/** task-03：面板 stats 全零 fixture（无文档 → 面板空态占位，不打真实请求）。 */
function zeroStats() {
  return {
    coverage: { std_have: 0, std_expected: 0, module_have: 0, module_expected: 0, trend: [] },
    stale_docs: [],
    density: { per_project_avg: 0 },
    freshness: { recent_updated: 0, total: 0 },
    recent_board: [],
    injection: { total_30d: 0, docs_hit_30d: 0, board: [] },
  };
}

// task-03：页面挂载的 ScanDocsStatsPanel 内部走 useQuery，渲染需 Provider 包裹
// （knowledge-page.test task-08 同款处理）。
let queryClient: QueryClient;

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ScanDocsPage params={{ id: WS }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("sillyhub-scan-docs-tree-width");
  mockReparse.mockResolvedValue({ stats: { parsed: 0, created: 0, updated: 0, deleted: 0 }, warnings: [] });
  mockBinding.mockResolvedValue({ daemon_id: "d-1" });
  mockDefaultDocs();
  mockStats.mockResolvedValue(zeroStats());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("scan-docs 页面（ql-20260821-013 文档树 antd 化）", () => {
  it("渲染文档树：目录/文件分用 lucide 图标，文件行带成员与类型徽标", async () => {
    renderPage();
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    // 目录 lucide-folder；.md 文件 lucide-file-text（FileNodeIcon 按扩展名分型）。
    const dirRow = screen.getByText("backend").closest(".ant-tree-treenode")!;
    expect(dirRow.querySelector(".ant-tree-iconEle svg.lucide-folder")).toBeTruthy();
    const fileRow = screen.getByText("ARCHITECTURE.md").closest(".ant-tree-treenode")!;
    expect(fileRow.querySelector(".ant-tree-iconEle svg.lucide-file-text")).toBeTruthy();
    // 徽标：README.md 带 doc_type=design 与来源成员前 8 位（slice(0,8)="member-1"）。
    expect(screen.getByText("design")).toBeInTheDocument();
    expect(screen.getByText(/member-1/)).toBeInTheDocument();
  });

  it("点击文件行 → getScanDoc(workspaceId, id) 拉详情并展示标题", async () => {
    mockGetDoc.mockResolvedValue(
      summary({ id: "id-arch", path: "backend/ARCHITECTURE.md", title: "架构文档", content: "# hello" }),
    );
    renderPage();
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    fireEvent.click(
      screen.getByText("ARCHITECTURE.md").closest(".ant-tree-node-content-wrapper")!,
    );
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledWith(WS, "id-arch"));
    await waitFor(() => expect(screen.getByText("架构文档")).toBeInTheDocument());
  });

  it("树栏默认 280px，拖动把手调宽并写入 localStorage 记忆", async () => {
    renderPage();
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    const panel = screen.getByTestId("scan-docs-tree-panel");
    // lg 固定宽走 CSS 变量（移动端全宽），断言变量值而非 style.width。
    expect(panel.style.getPropertyValue("--tree-w")).toBe("280px");

    const resizer = screen.getByTestId("scan-docs-tree-resizer");
    firePointer(resizer, "pointerDown", { clientX: 280 });
    firePointer(window, "pointerMove", { clientX: 400 });
    firePointer(window, "pointerUp");

    expect(panel.style.getPropertyValue("--tree-w")).toBe("400px");
    expect(localStorage.getItem("sillyhub-scan-docs-tree-width")).toBe("400");
  });
});

describe("scan-docs 首屏提速与人类可读视图（ql-20260921-003）", () => {
  it("列表先行：reparse 未返回时文档树已渲染（不阻塞首屏）", async () => {
    let resolveReparse!: (_v: unknown) => void;
    mockReparse.mockImplementation(
      () => new Promise((res) => { resolveReparse = res; }),
    );

    renderPage();
    // reparse 仍 pending：树已可用（旧实现会一直停在「加载中…」）。
    await waitForTree(["backend", "ARCHITECTURE.md", "README.md"]);
    expect(screen.getByTestId("bg-syncing-hint")).toBeInTheDocument();

    await act(async () => {
      resolveReparse({ stats: { parsed: 0, created: 0, updated: 0, deleted: 0 }, warnings: [] });
    });
  });

  it("后台 reparse 完成后静默刷新列表并撤下同步提示", async () => {
    renderPage();
    await waitForTree(["backend", "ARCHITECTURE.md"]);
    await waitFor(() => expect(mockReparse).toHaveBeenCalledWith(WS));
    // 首次加载 + 后台同步完成刷新 = 2 次。
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("bg-syncing-hint")).toBeNull());
  });

  it("md 文档默认卡片视图（人类可读），可切回原文", async () => {
    mockGetDoc.mockResolvedValue(
      summary({
        id: "id-arch",
        path: "backend/ARCHITECTURE.md",
        title: "架构文档",
        content: "## 模块划分\n前后端分离。",
      }),
    );
    renderPage();
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    fireEvent.click(
      screen.getByText("ARCHITECTURE.md").closest(".ant-tree-node-content-wrapper")!,
    );
    await waitFor(() => expect(screen.getByText("架构文档")).toBeInTheDocument());

    // 默认卡片视图：EntryCardList 渲染手册小节卡，原文（md-preview）不出现。
    const cardList = await waitFor(() => screen.getByTestId("entry-card-list"));
    expect(cardList).toHaveAttribute("data-form", "manual");
    expect(screen.getByText("模块划分")).toBeInTheDocument();
    expect(screen.queryByTestId("md-preview")).toBeNull();

    // 切到原文 tab：md 阅读视图出现（MarkdownText 是 dynamic 异步组件，waitFor），
    // 卡片消失。
    fireEvent.click(screen.getByTestId("view-tab-raw"));
    await waitFor(() => expect(screen.getByTestId("md-preview")).toBeInTheDocument());
    expect(screen.queryByTestId("entry-card-list")).toBeNull();

    // 切回卡片 tab。
    fireEvent.click(screen.getByTestId("view-tab-cards"));
    expect(screen.getByTestId("entry-card-list")).toBeInTheDocument();
  });
});

describe("运营指标面板挂载（task-03 / 2026-09-21-scan-docs-ops-panel）", () => {
  it("PageHeader 之下挂载面板：stats 独立请求 + 全零时空态占位不白屏", async () => {
    renderPage();
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    // 面板根存在（stats 全零 → 空态分支，根 testid 在各态根上）且请求带 WS。
    expect(screen.getByTestId("scan-docs-ops-panel")).toBeInTheDocument();
    expect(screen.getByTestId("scan-docs-ops-panel-empty")).toBeInTheDocument();
    await waitFor(() => expect(mockStats).toHaveBeenCalledWith(WS));
  });
});
