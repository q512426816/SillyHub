/**
 * 知识库页测试（ql-20260821-015-4637 重构后补）。
 *
 * 覆盖：
 * 1. 只渲染知识库（无快速日志 tab）；树渲染 + FileNodeIcon 按扩展名分型 + 日期灰字
 * 2. 点目录行展开/收起（expandAction=click）；点文件行 → getKnowledge 拉详情并 Markdown 渲染
 * 3. 树栏拖拽把手：默认 280px，拖动调宽 + localStorage 记忆
 * 4. WorkspaceTabs 含「知识库」tab，位于「文件」之后
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

vi.mock("@/lib/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge")>();
  return {
    ...actual,
    listKnowledge: vi.fn(),
    getKnowledge: vi.fn(),
  };
});

// MarkdownPreview 是 dynamic(ssr:false) 异步组件，直接替换为静态渲染避免测试环境异步挂载。
vi.mock("@uiw/react-markdown-preview", () => ({
  default: ({ source }: { source?: string }) => <div data-testid="md-preview">{source}</div>,
}));

// WorkspaceTabs 的 usePathname 需要 app router 上下文，jsdom 下 mock 掉
// （知识库页本身用 params prop，不受影响）。
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspaces/ws-1/knowledge",
}));

import KnowledgePage from "@/app/(dashboard)/workspaces/[id]/knowledge/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { getKnowledge, listKnowledge } from "@/lib/knowledge";

const mockList = listKnowledge as unknown as ReturnType<typeof vi.fn>;
const mockGet = getKnowledge as unknown as ReturnType<typeof vi.fn>;

const WS = "ws-1";

function entry(partial: Partial<Record<string, unknown>> & { filename: string; path: string }) {
  return {
    title: null,
    content: null,
    last_modified_at: null,
    ...partial,
  };
}

/** 默认：目录 backend/ 下 ARCHITECTURE.md + 根层 README.md。 */
function mockDefaultList() {
  mockList.mockResolvedValue({
    items: [
      entry({
        filename: "backend/ARCHITECTURE.md",
        path: "backend/ARCHITECTURE.md",
        last_modified_at: "2026-08-20T10:00:00Z",
      }),
      entry({ filename: "README.md", path: "README.md" }),
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

async function waitForTree(names: string[]) {
  await waitFor(() => {
    for (const n of names) expect(screen.getByText(n)).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("sillyhub-knowledge-tree-width");
  mockDefaultList();
});

afterEach(() => {
  cleanup();
});

describe("知识库页（ql-20260821-015 重构）", () => {
  it("树渲染：目录/文件分用 lucide 图标、日期灰字、无快速日志 tab", async () => {
    render(<KnowledgePage params={{ id: WS }} />);
    await waitForTree(["backend", "ARCHITECTURE.md", "README.md"]);

    // 无快速日志 tab（重构后只剩知识库）。
    expect(screen.queryByText("快速日志")).not.toBeInTheDocument();

    const dirRow = screen.getByText("backend").closest(".ant-tree-treenode")!;
    expect(dirRow.querySelector(".ant-tree-iconEle svg.lucide-folder")).toBeTruthy();
    const fileRow = screen.getByText("ARCHITECTURE.md").closest(".ant-tree-treenode")!;
    expect(fileRow.querySelector(".ant-tree-iconEle svg.lucide-file-text")).toBeTruthy();
    // 日期灰字（zh-CN 本地化，UTC 时间戳在本地时区渲染，断言年份+月日格式存在）。
    expect(fileRow.textContent).toMatch(/2026/);
  });

  it("点目录行收起/展开；点文件行 → getKnowledge 拉详情并 Markdown 渲染", async () => {
    mockGet.mockResolvedValue(
      entry({
        filename: "backend/ARCHITECTURE.md",
        path: "backend/ARCHITECTURE.md",
        title: "架构总览",
        content: "# 你好",
      }),
    );
    render(<KnowledgePage params={{ id: WS }} />);
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    // 点目录行 → 收起（子行隐藏，ql-20260821-015 expandAction=click）。
    fireEvent.click(screen.getByText("backend").closest(".ant-tree-node-content-wrapper")!);
    await waitFor(() =>
      expect(screen.queryByText("ARCHITECTURE.md")).not.toBeInTheDocument(),
    );
    // 再点 → 展开。
    fireEvent.click(screen.getByText("backend").closest(".ant-tree-node-content-wrapper")!);
    await waitForTree(["ARCHITECTURE.md"]);

    // 点文件行 → 拉详情 + .md 走 Markdown 渲染。
    fireEvent.click(
      screen.getByText("ARCHITECTURE.md").closest(".ant-tree-node-content-wrapper")!,
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(WS, "backend/ARCHITECTURE.md"));
    await waitFor(() => expect(screen.getByText("架构总览")).toBeInTheDocument());
    expect(screen.getByTestId("md-preview")).toHaveTextContent("# 你好");
  });

  it("树栏默认 280px，拖动把手调宽并写入 localStorage 记忆", async () => {
    render(<KnowledgePage params={{ id: WS }} />);
    await waitForTree(["backend", "ARCHITECTURE.md"]);

    const panel = screen.getByTestId("knowledge-tree-panel");
    expect(panel.style.getPropertyValue("--tree-w")).toBe("280px");

    const resizer = screen.getByTestId("knowledge-tree-resizer");
    firePointer(resizer, "pointerDown", { clientX: 280 });
    firePointer(window, "pointerMove", { clientX: 380 });
    firePointer(window, "pointerUp");

    expect(panel.style.getPropertyValue("--tree-w")).toBe("380px");
    expect(localStorage.getItem("sillyhub-knowledge-tree-width")).toBe("380");
  });
});

describe("WorkspaceTabs「知识库」tab（ql-20260821-015）", () => {
  it("标签列表包含「知识库」且 href 为 /knowledge，位于「文件」之后", () => {
    render(
      <WorkspaceTabs workspaceId="ws-1">
        <div />
      </WorkspaceTabs>,
    );

    const links = screen.getAllByRole("link");
    const labels = links.map((a) => a.textContent);
    const fileIdx = labels.indexOf("文件");
    const knowledgeIdx = labels.indexOf("知识库");
    expect(knowledgeIdx).toBeGreaterThan(fileIdx);
    expect(links[knowledgeIdx]).toHaveAttribute("href", "/workspaces/ws-1/knowledge");
  });
});
