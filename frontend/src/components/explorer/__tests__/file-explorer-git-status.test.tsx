import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// antd Tree / @rc-component/resize-observer 需要 ResizeObserver，jsdom 缺，补 mock。
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;
}

/**
 * task-07（2026-10-25-explorer-git-status / FR-01 / D-003@v2 / D-005 / D-011）：
 * explorer 树 git 状态着色测试——渲染期状态映射（Grill P2-③ 时序）。
 *
 * 覆盖（tasks/task-07.md acceptance）：
 * 1. 注入状态后节点类名断言（四色各一：modified 蓝 / added+untracked 绿 /
 *    deleted 在 fs 树上不出现——仅 Git 日志页，design §接口定义尾说明）；
 * 2. 忽略目录灰 + 「忽略」徽标（顶层聚合不递归——子节点不着色）；散落忽略
 *    单文件同徽标；
 * 3. 含改动祖先目录蓝点（dirtyAncestors，ignored 不贡献——D-011）；无关目录
 *    无蓝点；
 * 4. 无状态（空清单）/ 查询失败 → 与现状渲染一致（无 data-git-status、无色类）；
 * 5. **晚到数据变色**（P2-③ 核心）：树先渲染（dirty pending）→ dirty resolve
 *    → 已渲染节点无需重建 treeData 即变色；
 * 6. 点击行为回归（D-005）：着色节点点击仍触发 onSelectFile（内容预览不变）。
 *
 * mock 策略：@/lib/explorer（fetchTree）+ @/lib/api（apiFetch → dirty-files）
 * 双 mock，真实 react-query 缓存（晚到变色断言依赖 context 更新穿透）。
 */

vi.mock("@/lib/explorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/explorer")>();
  return {
    ...actual,
    fetchTree: vi.fn(),
    fetchSearch: vi.fn(),
  };
});

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { FileExplorer } from "../file-explorer";
import { fetchTree } from "@/lib/explorer";
import { closestAntdTreeNodeWrapper, queryAntdTreeSwitcher, closestAntdTreeRow } from "@/test/dom-queries";
import type { GitDirtyFilesResponse } from "@/lib/git-log";

const mockFetchTree = fetchTree as unknown as ReturnType<typeof vi.fn>;

const MTIME = "2026-08-18T00:00:00Z";
const dir = (name: string) => ({ name, type: "dir" as const, size: 0, mtime: MTIME });
const file = (name: string, size = 1024) => ({ name, type: "file" as const, size, mtime: MTIME });

function makeDirty(overrides: Partial<GitDirtyFilesResponse> = {}): GitDirtyFilesResponse {
  return {
    git_mode: "git",
    head_short: "a9f5fae1",
    empty: false,
    files: [
      // modified（蓝）位于 src/ 下；added（绿）与 untracked（绿）在根层。
      { path: "src/app/page.tsx", status: "modified", additions: 3, deletions: 1, binary: false },
      { path: "新文件.md", status: "added", additions: 5, deletions: 0, binary: false },
      { path: "notes/draft.md", status: "untracked", additions: null, deletions: null, binary: false },
      // deleted 在 fs 树上不存在（仅 Git 日志页出现）——着色不命中。
      { path: "gone.ts", status: "deleted", additions: 0, deletions: 9, binary: false },
    ],
    ignored: [
      { path: "node_modules/", is_dir: true },
      { path: "legacy.log", is_dir: false },
    ],
    ...overrides,
  };
}

/** 树形：根层 = node_modules/、src/、notes/、docs/、README.md、legacy.log、新文件.md；
 *  notes 下有 draft.md（untracked 着色锚）；src 子树深层形态由个别用例自覆写。 */
function mockTree() {
  mockFetchTree.mockImplementation(async (_ws: string, path: string) => {
    switch (path) {
      case "":
        return {
          entries: [
            dir("node_modules"),
            dir("src"),
            dir("notes"),
            dir("docs"),
            file("README.md", 2048),
            file("legacy.log", 10),
            file("新文件.md", 512),
          ],
        };
      case "notes":
        return { entries: [file("draft.md", 64)] };
      default:
        return { entries: [] };
    }
  });
}

function renderExplorer(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function waitForRoot() {
  await waitFor(() => expect(screen.getByText("工作区根")).toBeInTheDocument());
}

/** 取节点名的着色 span（title+data-git-status 双属性锚定；无色时 undefined）。 */
function coloredSpanOf(name: string): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>(
      `span[data-git-status][title="${CSS.escape(name)}"]`,
    ) ?? undefined
  );
}

async function expandDir(name: string, ws = "ws1", path = "") {
  const row = closestAntdTreeRow(screen.getByText(name));
  const switcher = queryAntdTreeSwitcher(row as HTMLElement);
  const rowsBefore = document.querySelectorAll(".ant-tree-treenode").length;
  if (switcher) fireEvent.click(switcher);
  await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith(ws, path === "" ? name : path));
  // 等子行真正渲染（2026-10-26-ci-red-to-green）：fetch 已发≠DOM 已渲染——CI 满载
  // 下 antd Tree 懒加载子节点晚一帧到达，调用方紧跟的 getByText(子名) 不等待即
  // 竞态必红（CI 三连挂实证）。以行数增长为「子行已出」信号（children 非空路径）。
  await waitFor(() => {
    expect(document.querySelectorAll(".ant-tree-treenode").length).toBeGreaterThan(rowsBefore);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTree();
});
afterEach(() => {
  cleanup();
});

describe("FileExplorer git 着色（task-07，FR-01）", () => {
  it("added/untracked 绿；deleted 不在 fs 树上不出现（着色零命中）", async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("dirty-files")) return makeDirty();
      throw new Error(`unexpected apiFetch: ${url}`);
    });
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    // added（绿）：根层 新文件.md。
    const added = await waitFor(() => {
      const el = coloredSpanOf("新文件.md");
      if (!el) throw new Error("added not colored yet");
      return el;
    });
    expect(added.dataset.gitStatus).toBe("added");
    expect(added.className).toContain("text-success");

    // untracked（绿）：notes 展开后 draft.md。
    await expandDir("notes");
    const untracked = await waitFor(() => {
      const el = coloredSpanOf("draft.md");
      if (!el) throw new Error("untracked not colored yet");
      return el;
    });
    expect(untracked.dataset.gitStatus).toBe("untracked");
    expect(untracked.className).toContain("text-success");

    // deleted：fs 树上不存在该节点（无着色命中、树上无 gone.ts 文本）。
    expect(screen.queryByText("gone.ts")).not.toBeInTheDocument();
  });

  it("modified 文件蓝 + 祖先目录蓝点（dirtyAncestors）", async () => {
    mockFetchTree.mockImplementation(async (_ws: string, path: string) => {
      switch (path) {
        case "":
          return { entries: [dir("src"), file("README.md", 2048)] };
        case "src":
          return { entries: [dir("app")] };
        case "src/app":
          return { entries: [file("page.tsx", 4301)] };
        default:
          return { entries: [] };
      }
    });
    apiFetchMock.mockImplementation(async (url: string) =>
      String(url).includes("dirty-files") ? makeDirty() : undefined,
    );
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    // 懒加载逐层展开：src → src/app → page.tsx 叶子渲染。
    await expandDir("src");
    await expandDir("app", "ws1", "src/app");

    const modified = await waitFor(() => {
      const el = coloredSpanOf("page.tsx");
      if (!el) throw new Error("page.tsx not colored yet");
      return el;
    });
    expect(modified.dataset.gitStatus).toBe("modified");
    expect(modified.className).toContain("text-primary");
  });

  it("忽略目录灰 + 「忽略」徽标且不递归；散落忽略单文件同徽标", async () => {
    apiFetchMock.mockImplementation(async (url: string) =>
      String(url).includes("dirty-files") ? makeDirty() : undefined,
    );
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();

    // 忽略目录：node_modules 整体灰 + 徽标。
    await waitFor(() => {
      expect(screen.getByTestId("git-ignored-badge-node_modules")).toBeInTheDocument();
    });
    const nm = await waitFor(() => {
      const el = coloredSpanOf("node_modules");
      if (!el) throw new Error("node_modules not colored");
      return el;
    });
    expect(nm.dataset.gitStatus).toBe("ignored");
    expect(nm.className).toContain("text-muted-foreground");

    // 散落忽略单文件。
    const legacy = await waitFor(() => {
      const el = coloredSpanOf("legacy.log");
      if (!el) throw new Error("legacy.log not colored");
      return el;
    });
    expect(legacy.dataset.gitStatus).toBe("ignored");

    // 无关目录（docs）不着色无徽标。
    expect(coloredSpanOf("docs")).toBeUndefined();
  });

  it("含改动祖先目录蓝点；无关目录无蓝点（D-011：ignored 不贡献）", async () => {
    apiFetchMock.mockImplementation(async (url: string) =>
      String(url).includes("dirty-files") ? makeDirty() : undefined,
    );
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    // src 子树含 modified → src 有蓝点；notes 子树含 untracked → notes 有蓝点；
    // docs 无改动、node_modules 是 ignored（不贡献）→ 均无蓝点。
    await waitFor(() => {
      expect(screen.getByTestId("git-dirty-dot-src")).toBeInTheDocument();
      expect(screen.getByTestId("git-dirty-dot-notes")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("git-dirty-dot-docs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("git-dirty-dot-node_modules")).not.toBeInTheDocument();
  });

  it("空清单 → 与现状渲染一致（无 data-git-status 标记）", async () => {
    apiFetchMock.mockImplementation(async (url: string) =>
      String(url).includes("dirty-files")
        ? makeDirty({ files: [], ignored: [] })
        : undefined,
    );
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-git-status]")).toHaveLength(0);
    });
    // 树正常渲染（现状行为不变）。
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("查询失败 → 静默降级无色（不抛 UI 错误、树正常浏览）", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("晚到 dirty-files 变色（P2-③ 渲染期读取，无需重建 treeData）", async () => {
    // 先永挂起 dirty 请求 → 树渲染完成且无色；再放行 → 已渲染节点变色。
    // holder 对象承载 resolve（let + 闭包赋值会被 TS 控制流窄化成 null 不可调用）。
    const holder: { resolve?: (v: GitDirtyFilesResponse) => void } = {};
    apiFetchMock.mockImplementation(
      (url: unknown) =>
        new Promise((resolve) => {
          if (String(url).includes("dirty-files")) {
            holder.resolve = resolve as (v: GitDirtyFilesResponse) => void;
          }
        }),
    );
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={vi.fn()} />);
    await waitForRoot();
    // 无色形态。
    expect(coloredSpanOf("新文件.md")).toBeUndefined();

    holder.resolve?.(makeDirty());
    const colored = await waitFor(() => {
      const el = coloredSpanOf("新文件.md");
      if (!el) throw new Error("not colored after late data");
      return el;
    });
    expect(colored.dataset.gitStatus).toBe("added");
  });

  it("点击行为回归（D-005）：着色文件节点点击仍触发 onSelectFile", async () => {
    apiFetchMock.mockImplementation(async (url: string) =>
      String(url).includes("dirty-files") ? makeDirty() : undefined,
    );
    const onSelectFile = vi.fn();
    renderExplorer(<FileExplorer workspaceId="ws1" onSelectFile={onSelectFile} />);
    await waitForRoot();
    await waitFor(() => {
      expect(coloredSpanOf("新文件.md")).toBeDefined();
    });
    fireEvent.click(closestAntdTreeNodeWrapper(screen.getByText("新文件.md")) as HTMLElement);
    expect(onSelectFile).toHaveBeenCalledWith("新文件.md");
  });
});
