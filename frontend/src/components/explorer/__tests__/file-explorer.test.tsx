import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

// antd Tree / @rc-component/resize-observer 需要 ResizeObserver，jsdom 缺，补 mock。
// 放 import 后、describe 前（模块顶层代码先于测试函数 render 执行）。
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

// task-06: FileExplorer 组件测试。聚焦可稳定断言的行为（数据层全 mock，不真实发请求）：
//   - 根层加载 / 同级排序（目录优先再按名）/ lucide 图标渲染
//   - antd Tree loadData 懒加载逐层展开（只取当前层，不递归预取）
//   - 点击文件节点 → onSelectFile(相对根 POSIX 路径)
//   - 根加载失败红条 + 重试 / 单节点展开失败降级（空 children + 红条不崩溃）/ 空目录可区分
//   - 搜索防抖（输入不立即查，300ms 后查）/ 回车提交立即查 / truncated 提示
//   - 祖先链直达：搜索结果点击后逐层 fetchTree 展开 + 最终选中 + onSelectFile；目录命中展开选中不回调
// 注：本组件 Tree 未设 height（无虚拟滚动），节点直接渲染进 DOM，jsdom 下 switcher
//     展开交互可稳定触发（remote-folder-picker 设了 height 走虚拟列表才不稳定）。

vi.mock("@/lib/explorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/explorer")>();
  return {
    ...actual,
    fetchTree: vi.fn(),
    fetchSearch: vi.fn(),
  };
});

import { FileExplorer } from "../file-explorer";
import { fetchTree, fetchSearch } from "@/lib/explorer";

const mockFetchTree = fetchTree as unknown as ReturnType<typeof vi.fn>;
const mockFetchSearch = fetchSearch as unknown as ReturnType<typeof vi.fn>;

const MTIME = "2026-08-18T00:00:00Z";
const dir = (name: string) => ({ name, type: "dir" as const, size: 0, mtime: MTIME });
const file = (name: string, size = 1024) => ({ name, type: "file" as const, size, mtime: MTIME });

/** 默认三层树："" → backend/README.md；backend → app/pyproject.toml；backend/app → main.py。 */
function mockDefaultTree() {
  mockFetchTree.mockImplementation(async (_ws: string, path: string) => {
    switch (path) {
      case "":
        return { entries: [dir("backend"), file("README.md", 2048)] };
      case "backend":
        return { entries: [dir("app"), file("pyproject.toml", 4096)] };
      case "backend/app":
        return { entries: [file("main.py", 4301)] };
      default:
        return { entries: [] };
    }
  });
}

/** 等根层加载完成（fetchTree("") 返回且树渲染）。 */
async function waitForRoot() {
  await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith("ws1", ""));
  await waitFor(() => expect(screen.getByText("工作区根")).toBeInTheDocument());
}

/** 点某目录行的 switcher 触发展开。 */
function expandRow(name: string) {
  const row = screen.getByText(name).closest(".ant-tree-treenode");
  expect(row).toBeTruthy();
  const switcher = row!.querySelector(".ant-tree-switcher");
  expect(switcher).toBeTruthy();
  fireEvent.click(switcher!);
}

/** 双击某节点行标题（expandAction=doubleClick 的展开/收起触发方式）。 */
function dblClickNode(name: string) {
  fireEvent.doubleClick(screen.getByText(name).closest(".ant-tree-node-content-wrapper")!);
}

/** 点某节点行标题触发选中。 */
function clickNode(name: string) {
  fireEvent.click(screen.getByText(name).closest(".ant-tree-node-content-wrapper")!);
}

/** 提交搜索词（回车立即查）。 */
function submitSearch(q: string) {
  const input = screen.getByPlaceholderText("搜索文件名…");
  fireEvent.change(input, { target: { value: q } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/**
 * 等搜索结果面板出现并点其中一条结果。必须圈定面板范围——结果文本可能与树内同名
 * 节点撞文本（如命中根层目录 "backend"），裸 findByText 会在面板渲染前抢跑命中树行。
 */
async function clickResult(path: string) {
  const panel = await screen.findByTestId("explorer-search-results");
  fireEvent.click(within(panel).getByText(path));
}

describe("FileExplorer（task-06）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 根层加载 / 排序 / 图标 ─────────────────────────────────────────────

  it("挂载 → fetchTree(wsId, '') 拉根层一次，渲染根节点与一级条目", async () => {
    mockDefaultTree();
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    expect(screen.getByText("backend")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // 只取当前层：根层加载不预取子目录。
    expect(mockFetchTree).toHaveBeenCalledTimes(1);
    expect(mockFetchTree).toHaveBeenCalledWith("ws1", "");
  });

  it("同级排序：目录先于文件再按名；目录/文件分用 lucide 图标", async () => {
    mockFetchTree.mockResolvedValue({
      entries: [file("z.md"), dir("b"), dir("a"), file("a.txt")],
    });
    const { container } = render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    // 根自动展开 → 一级条目按「目录优先再按名」渲染（后端已保证，前端兜底排序）。
    const titles = Array.from(container.querySelectorAll(".ant-tree-title")).map((el) =>
      el.textContent!.replace(/\d+(\.\d+)?\s?(B|KB|MB|GB)$/, ""),
    );
    expect(titles).toEqual(["工作区根", "a", "b", "a.txt", "z.md"]);
    // 图标：目录 lucide-folder / 文件 lucide-file-text。
    const dirRow = screen.getByText("a").closest(".ant-tree-treenode")!;
    expect(dirRow.querySelector("svg.lucide-folder")).toBeTruthy();
    const fileRow = screen.getByText("a.txt").closest(".ant-tree-treenode")!;
    expect(fileRow.querySelector("svg.lucide-file-text")).toBeTruthy();
  });

  // ── 懒加载 / 文件选中 ─────────────────────────────────────────────────

  it("展开目录 → loadData 调 fetchTree(wsId, 该目录 rel 路径)，只取当前层不递归预取", async () => {
    mockDefaultTree();
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    expandRow("backend");
    await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith("ws1", "backend"));
    // 子级渲染出来。
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(screen.getByText("pyproject.toml")).toBeInTheDocument();
    // 不预取孙层：调用序列只有 "" 和 "backend"。
    const paths = mockFetchTree.mock.calls.map((c) => c[1]);
    expect(paths).toEqual(["", "backend"]);
  });

  it("点击文件节点 → onSelectFile 带相对根 POSIX 路径（根层 + 子层）", async () => {
    mockDefaultTree();
    const onSelectFile = vi.fn();
    render(<FileExplorer workspaceId="ws1" onSelectFile={onSelectFile} />);
    await waitForRoot();

    clickNode("README.md");
    expect(onSelectFile).toHaveBeenCalledWith("README.md");

    expandRow("backend");
    await waitFor(() => expect(screen.getByText("pyproject.toml")).toBeInTheDocument());
    clickNode("pyproject.toml");
    expect(onSelectFile).toHaveBeenCalledWith("backend/pyproject.toml");
  });

  it("点击目录节点 → 只选中不触发 onSelectFile", async () => {
    mockDefaultTree();
    const onSelectFile = vi.fn();
    render(<FileExplorer workspaceId="ws1" onSelectFile={onSelectFile} />);
    await waitForRoot();

    clickNode("backend");
    expect(onSelectFile).not.toHaveBeenCalled();
    const wrapper = screen.getByText("backend").closest(".ant-tree-node-content-wrapper")!;
    expect(wrapper.className).toContain("ant-tree-node-selected");
  });

  it("双击目录节点 → 展开并懒加载当前层（等价 switcher 展开）", async () => {
    mockDefaultTree();
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    dblClickNode("backend");
    await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith("ws1", "backend"));
    await waitFor(() => expect(screen.getByText("pyproject.toml")).toBeInTheDocument());
    // 只取当前层不递归预取。
    const paths = mockFetchTree.mock.calls.map((c) => c[1]);
    expect(paths).toEqual(["", "backend"]);
  });

  it("双击已展开目录 → 收起（子行隐藏、不重复拉取）", async () => {
    mockDefaultTree();
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    dblClickNode("backend");
    await waitFor(() => expect(screen.getByText("pyproject.toml")).toBeInTheDocument());
    dblClickNode("backend");
    await waitFor(() => expect(screen.queryByText("pyproject.toml")).not.toBeInTheDocument());
    expect(mockFetchTree).toHaveBeenCalledTimes(2); // "" + "backend"，收起不发请求
  });

  it("双击文件节点 → 不触发展开请求（叶子忽略）", async () => {
    mockDefaultTree();
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    dblClickNode("README.md");
    await act(async () => {});
    expect(mockFetchTree).toHaveBeenCalledTimes(1); // 仅根层
  });

  // ── 失败降级 / 空态 ───────────────────────────────────────────────────

  it("根加载失败 → 红条提示不崩溃，点「重试」重新拉根", async () => {
    mockFetchTree.mockRejectedValue(new Error("daemon offline"));
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/daemon offline|无法加载文件树/);
    // 重试（antd 两字按钮自动加字间距，name 用正则兼容「重 试」）
    mockFetchTree.mockResolvedValue({ entries: [file("README.md")] });
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await waitFor(() => expect(mockFetchTree).toHaveBeenCalledTimes(2));
    await waitForRoot();
  });

  it("单节点展开失败 → 置空 children + 红条提示，树不崩溃", async () => {
    mockFetchTree.mockImplementation(async (_ws: string, path: string) => {
      if (path === "") return { entries: [dir("backend"), file("README.md")] };
      throw new Error("boom");
    });
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    expandRow("backend");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/无法展开该目录|boom/);
    });
    // 树仍在（根层条目未丢）。
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("工作区根")).toBeInTheDocument();
  });

  it("空目录：展开无红条、无子行（与失败可区分）", async () => {
    mockFetchTree.mockImplementation(async (_ws: string, path: string) => {
      if (path === "") return { entries: [dir("empty-dir"), file("README.md")] };
      return { entries: [] };
    });
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    expandRow("empty-dir");
    await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith("ws1", "empty-dir"));
    // 等一拍让 loadData promise 落定，仍无错误条。
    await act(async () => {});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  // ── 搜索：防抖 / 提交 / truncated ──────────────────────────────────────

  it("输入防抖 300ms 才触发 fetchSearch，结果面板列出相对路径", async () => {
    mockDefaultTree();
    mockFetchSearch.mockResolvedValue({
      matches: [{ path: "backend/app/main.py", name: "main.py", type: "file" }],
      truncated: false,
    });
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    fireEvent.change(screen.getByPlaceholderText("搜索文件名…"), {
      target: { value: "main" },
    });
    // 防抖：输入当下不立即查。
    expect(mockFetchSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(mockFetchSearch).toHaveBeenCalledWith("ws1", "main"));
    // 结果面板渲染命中路径。
    expect(await screen.findByText("backend/app/main.py")).toBeInTheDocument();
  });

  it("回车提交立即搜索（不等防抖）", async () => {
    mockDefaultTree();
    mockFetchSearch.mockResolvedValue({ matches: [], truncated: false });
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    submitSearch("main");
    // 立即触发（150ms 窗口，防抖 300ms 不可能命中，可区分两条路径）。
    await waitFor(() => expect(mockFetchSearch).toHaveBeenCalledWith("ws1", "main"), {
      timeout: 150,
    });
    expect(await screen.findByText("未找到匹配的文件或目录")).toBeInTheDocument();
  });

  it("truncated=true → 显示「结果超过 100 条，仅显示前 100」提示", async () => {
    mockDefaultTree();
    mockFetchSearch.mockResolvedValue({
      matches: [{ path: "a.py", name: "a.py", type: "file" }],
      truncated: true,
    });
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    submitSearch("a");
    expect(await screen.findByText("结果超过 100 条，仅显示前 100")).toBeInTheDocument();
    expect(screen.getByText("a.py")).toBeInTheDocument();
  });

  it("搜索失败 → 面板内错误提示不崩溃", async () => {
    mockDefaultTree();
    mockFetchSearch.mockRejectedValue(new Error("search down"));
    render(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    submitSearch("main");
    expect(await screen.findByText(/search down|搜索失败/)).toBeInTheDocument();
    expect(screen.getByText("工作区根")).toBeInTheDocument();
  });

  // ── 祖先链直达 ────────────────────────────────────────────────────────

  it("点搜索结果 → 祖先链逐层 fetchTree 展开、目标文件选中并回调 onSelectFile，面板收起", async () => {
    mockDefaultTree();
    mockFetchSearch.mockResolvedValue({
      matches: [{ path: "backend/app/main.py", name: "main.py", type: "file" }],
      truncated: false,
    });
    const onSelectFile = vi.fn();
    render(<FileExplorer workspaceId="ws1" onSelectFile={onSelectFile} />);
    await waitForRoot();

    submitSearch("main");
    await clickResult("backend/app/main.py");

    // 直达完成：onSelectFile 收到相对路径。
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith("backend/app/main.py"));
    // 祖先链逐层拉取：""（根，挂载时）→ backend → backend/app，无多余层。
    const paths = mockFetchTree.mock.calls.map((c) => c[1]);
    expect(paths).toEqual(["", "backend", "backend/app"]);
    // 各级目录已展开（深层节点渲染出来）且目标节点选中。
    await waitFor(() => {
      const wrapper = screen.getByText("main.py").closest(".ant-tree-node-content-wrapper")!;
      expect(wrapper.className).toContain("ant-tree-node-selected");
    });
    expect(screen.getByText("app")).toBeInTheDocument();
    // 搜索面板收起、输入框清空。
    expect(screen.queryByTestId("explorer-search-results")).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText("搜索文件名…") as HTMLInputElement).value).toBe("");
  });

  it("命中为目录 → 拉一层子节点并展开选中，不触发 onSelectFile", async () => {
    mockDefaultTree();
    mockFetchSearch.mockResolvedValue({
      matches: [{ path: "backend", name: "backend", type: "dir" }],
      truncated: false,
    });
    const onSelectFile = vi.fn();
    render(<FileExplorer workspaceId="ws1" onSelectFile={onSelectFile} />);
    await waitForRoot();

    submitSearch("backend");
    await clickResult("backend");

    // 目录直达：拉 backend 一层，子级渲染，目录行选中，无 onSelectFile。
    await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith("ws1", "backend"));
    await waitFor(() => expect(screen.getByText("pyproject.toml")).toBeInTheDocument());
    expect(onSelectFile).not.toHaveBeenCalled();
    const wrapper = screen.getByText("backend").closest(".ant-tree-node-content-wrapper")!;
    expect(wrapper.className).toContain("ant-tree-node-selected");
    const paths = mockFetchTree.mock.calls.map((c) => c[1]);
    expect(paths).toEqual(["", "backend"]);
  });
});
