/**
 * scan-docs 页面测试（ql-20260821-013-2c1a 左树 antd Tree 化后补）。
 *
 * 覆盖：
 * 1. 文档树渲染：目录/文件行 + FileNodeIcon 按扩展名分型（.md → lucide-file-text）+ 徽标
 * 2. 点击文件行 → getScanDoc(workspaceId, id) 拉详情并展示标题
 * 3. 树栏拖拽把手：默认 280px，拖动调宽 + localStorage 记忆
 */

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  useSession: (sel: (s: unknown) => unknown) =>
    sel({ user: { permissions: [], is_platform_admin: false } }),
}));

// MarkdownPreview 是 dynamic(ssr:false) 异步组件，直接替换为静态渲染避免测试环境异步挂载。
vi.mock("@uiw/react-markdown-preview", () => ({
  default: ({ source }: { source?: string }) => <div data-testid="md-preview">{source}</div>,
}));

import ScanDocsPage from "@/app/(dashboard)/workspaces/[id]/scan-docs/page";
import { getScanDoc, listScanDocs, reparseScanDocs } from "@/lib/scan-docs";
import { fetchMyBinding } from "@/lib/workspace-binding";

const mockList = listScanDocs as unknown as ReturnType<typeof vi.fn>;
const mockReparse = reparseScanDocs as unknown as ReturnType<typeof vi.fn>;
const mockGetDoc = getScanDoc as unknown as ReturnType<typeof vi.fn>;
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("sillyhub-scan-docs-tree-width");
  mockReparse.mockResolvedValue({ stats: { parsed: 0, created: 0, updated: 0, deleted: 0 }, warnings: [] });
  mockBinding.mockResolvedValue({ daemon_id: "d-1" });
  mockDefaultDocs();
});

afterEach(() => {
  cleanup();
});

describe("scan-docs 页面（ql-20260821-013 文档树 antd 化）", () => {
  it("渲染文档树：目录/文件分用 lucide 图标，文件行带成员与类型徽标", async () => {
    render(<ScanDocsPage params={{ id: WS }} />);
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
    render(<ScanDocsPage params={{ id: WS }} />);
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    fireEvent.click(
      screen.getByText("ARCHITECTURE.md").closest(".ant-tree-node-content-wrapper")!,
    );
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledWith(WS, "id-arch"));
    await waitFor(() => expect(screen.getByText("架构文档")).toBeInTheDocument());
  });

  it("树栏默认 280px，拖动把手调宽并写入 localStorage 记忆", async () => {
    render(<ScanDocsPage params={{ id: WS }} />);
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
