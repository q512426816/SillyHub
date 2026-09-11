import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * portal-file-panels 单测（2026-09-09-sessions-file-browser-three-pane task-01）。
 *
 * 依据：
 *   - components/sessions/portal-file-panels.tsx（两壳组件 + 宽度常量实现）
 *   - design.md §5.C / §7（PortalFileTreePanelProps / PortalFilePreviewPanelProps
 *     逐字契约与宽度常量默认/上下限）、§8 D-001（纯组合零 explorer 新逻辑）、
 *     D-004（workspaceId 快照防串档）、D-005（左栏默认 320 与现状一致）
 *   - tasks/task-01.md acceptance：两组件渲染 / onBack/onClose/onSelectFile
 *     直通 / 常量数值断言
 *
 * 覆盖：
 *   1. 两组件渲染——树壳头部「返回会话」按钮（sessions-files-back）+「工作区文件」
 *      标题 + FileExplorer 真实树根/首层条目；预览壳头部 filePath 文本（title 全路径）
 *      + 「✕」关闭按钮（sessions-file-preview-close）+ FilePreview 以面板入参取数
 *   2. onBack / onClose 回调直通——fireEvent.click 锚点按钮断言各自回调被调用
 *   3. onSelectFile 直通——点文件树行断言回调收到相对工作区根的 POSIX 路径
 *      （根层文件 + 展开目录后的嵌套文件两级）
 *   4. 宽度常量——两个 LS key 为字符串，左栏 320/240/560、预览列 480/320/860
 *      数值齐全（task-03 sessions-portal 消费）
 *
 * mock 策略（R-04 分层——壳层只 mock 取数，FileExplorer/FilePreview 真实渲染）：
 *   - @/lib/explorer 经 importOriginal 整模块展开后覆写取数面：fetchTree /
 *     fetchSearch（FileExplorer 直调）与 useExplorerFile / fetchDownload /
 *     downloadExplorerFile（FilePreview 消费），其余导出（类型与 queryKeys）原样保留
 *   - fetchTree 返回 { entries: [{ name, type, size, mtime }] }（字段照
 *     api-types ExplorerEntry 生成 schema）；useExplorerFile 返回受控 useQuery
 *     形状 { data, isPending, isError, error }——常驻 pending（Spin 分支），
 *     内容分发矩阵归 explorer 既有测试，此处只验壳层接线
 *   - jsdom 桩（ResizeObserver / matchMedia / URL.createObjectURL）由
 *     src/test/setup.ts 统一补齐，本文件不重复
 */
vi.mock("@/lib/explorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/explorer")>();
  return {
    ...actual,
    fetchTree: vi.fn(),
    fetchSearch: vi.fn(),
    useExplorerFile: vi.fn(),
    fetchDownload: vi.fn(),
    downloadExplorerFile: vi.fn(),
  };
});

import {
  PortalFileTreePanel,
  PortalFilePreviewPanel,
  SESSIONS_LEFT_PANEL_WIDTH_LS_KEY,
  SESSIONS_LEFT_PANEL_WIDTH_DEFAULT,
  SESSIONS_LEFT_PANEL_WIDTH_MIN,
  SESSIONS_LEFT_PANEL_WIDTH_MAX,
  SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY,
  SESSIONS_FILE_PREVIEW_WIDTH_DEFAULT,
  SESSIONS_FILE_PREVIEW_WIDTH_MIN,
  SESSIONS_FILE_PREVIEW_WIDTH_MAX,
} from "../portal-file-panels";
import { fetchTree, useExplorerFile } from "@/lib/explorer";

const mockFetchTree = fetchTree as unknown as ReturnType<typeof vi.fn>;
const mockUseExplorerFile = useExplorerFile as unknown as ReturnType<typeof vi.fn>;

const MTIME = "2026-09-08T00:00:00Z";
const dir = (name: string) => ({ name, type: "dir" as const, size: 0, mtime: MTIME });
const file = (name: string, size = 1024) => ({ name, type: "file" as const, size, mtime: MTIME });

/** 两层树："" → backend/README.md；backend → pyproject.toml。 */
function mockDefaultTree() {
  mockFetchTree.mockImplementation(async (_ws: string, path: string) => {
    switch (path) {
      case "":
        return { entries: [dir("backend"), file("README.md", 2048)] };
      case "backend":
        return { entries: [file("pyproject.toml", 4096)] };
      default:
        return { entries: [] };
    }
  });
}

/** FilePreview 取数桩：常驻 pending（loading 分支）——壳层只验头部与取数接线。 */
function mockPendingFileQuery() {
  mockUseExplorerFile.mockReturnValue({
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
  });
}

/** 等根层加载完成（fetchTree("") 返回且树渲染）。 */
async function waitForRoot() {
  await waitFor(() => expect(mockFetchTree).toHaveBeenCalledWith("ws1", ""));
  await waitFor(() => expect(screen.getByText("工作区根")).toBeInTheDocument());
}

/** 点某目录行的 switcher 触发展开（file-explorer.test 同款）。 */
function expandRow(name: string) {
  const row = screen.getByText(name).closest(".ant-tree-treenode");
  expect(row).toBeTruthy();
  const switcher = row!.querySelector(".ant-tree-switcher");
  expect(switcher).toBeTruthy();
  fireEvent.click(switcher!);
}

/** 点某节点行标题触发选中（file-explorer.test 同款）。 */
function clickNode(name: string) {
  fireEvent.click(screen.getByText(name).closest(".ant-tree-node-content-wrapper")!);
}

describe("portal-file-panels（task-01）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultTree();
    mockPendingFileQuery();
  });

  // ── 两组件渲染 ───────────────────────────────────────────────────────

  it("PortalFileTreePanel 渲染：头部「返回会话」+「工作区文件」+ FileExplorer 树根/首层条目", async () => {
    render(
      <PortalFileTreePanel workspaceId="ws1" onBack={() => {}} onSelectFile={() => {}} />,
    );

    expect(screen.getByTestId("sessions-files-back")).toBeInTheDocument();
    expect(screen.getByText("返回会话")).toBeInTheDocument();
    expect(screen.getByLabelText("返回会话")).toBeInTheDocument();
    expect(screen.getByText("工作区文件")).toBeInTheDocument();

    // FileExplorer 真实渲染：根层加载完成出现根节点与首层条目（搜索框同现）。
    await waitForRoot();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索文件名…")).toBeInTheDocument();
  });

  it("PortalFilePreviewPanel 渲染：头部 filePath 文本（title 全路径）+「✕」+ FilePreview 以面板入参取数", async () => {
    render(
      <PortalFilePreviewPanel
        workspaceId="ws1"
        filePath="backend/pyproject.toml"
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("sessions-file-preview-close")).toBeInTheDocument();
    expect(screen.getByLabelText("关闭文件预览")).toBeInTheDocument();
    const pathText = screen.getByText("backend/pyproject.toml");
    expect(pathText).toHaveAttribute("title", "backend/pyproject.toml");

    // FilePreview 真实渲染：以壳透传的 workspaceId/filePath 发起取数（桩 pending → loading 态）。
    await waitFor(() =>
      expect(mockUseExplorerFile).toHaveBeenCalledWith("ws1", "backend/pyproject.toml"),
    );
  });

  // ── 回调直通 ─────────────────────────────────────────────────────────

  it("onBack 直通：点 sessions-files-back 触发回调", () => {
    const onBack = vi.fn();
    render(
      <PortalFileTreePanel workspaceId="ws1" onBack={onBack} onSelectFile={() => {}} />,
    );

    fireEvent.click(screen.getByTestId("sessions-files-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("onClose 直通：点 sessions-file-preview-close 触发回调", () => {
    const onClose = vi.fn();
    render(
      <PortalFilePreviewPanel
        workspaceId="ws1"
        filePath="README.md"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("sessions-file-preview-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("onSelectFile 直通：点根层文件树行 → 回调收到相对工作区根路径", async () => {
    const onSelectFile = vi.fn();
    render(
      <PortalFileTreePanel workspaceId="ws1" onBack={() => {}} onSelectFile={onSelectFile} />,
    );

    await waitForRoot();
    clickNode("README.md");
    expect(onSelectFile).toHaveBeenCalledWith("README.md");
  });

  it("onSelectFile 直通（嵌套路径）：展开目录后点子文件 → 收到 backend/pyproject.toml", async () => {
    const onSelectFile = vi.fn();
    render(
      <PortalFileTreePanel workspaceId="ws1" onBack={() => {}} onSelectFile={onSelectFile} />,
    );

    await waitForRoot();
    expandRow("backend");
    // fetchTree 发起 ≠ 子节点已渲染（promise 解析 + 树重渲染还差一拍）——
    // 先等子文件文本出现再点，对齐 file-explorer.test 同款（CI 上曾只等 fetch
    // 调用就 getByText，子级未渲染即点导致 "Unable to find pyproject.toml"）。
    await waitFor(() =>
      expect(mockFetchTree).toHaveBeenCalledWith("ws1", "backend"),
    );
    await waitFor(() =>
      expect(screen.getByText("pyproject.toml")).toBeInTheDocument(),
    );
    clickNode("pyproject.toml");
    expect(onSelectFile).toHaveBeenCalledWith("backend/pyproject.toml");
  });

  // ── 宽度常量（task-03 sessions-portal 消费） ─────────────────────────

  it("常量断言：LS key 为字符串，左栏 320/240/560、预览列 480/320/860 数值齐全", () => {
    expect(typeof SESSIONS_LEFT_PANEL_WIDTH_LS_KEY).toBe("string");
    expect(SESSIONS_LEFT_PANEL_WIDTH_LS_KEY.length).toBeGreaterThan(0);
    expect(typeof SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY).toBe("string");
    expect(SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY.length).toBeGreaterThan(0);

    expect(SESSIONS_LEFT_PANEL_WIDTH_DEFAULT).toBe(320);
    expect(SESSIONS_LEFT_PANEL_WIDTH_MIN).toBe(240);
    expect(SESSIONS_LEFT_PANEL_WIDTH_MAX).toBe(560);

    expect(SESSIONS_FILE_PREVIEW_WIDTH_DEFAULT).toBe(480);
    expect(SESSIONS_FILE_PREVIEW_WIDTH_MIN).toBe(320);
    expect(SESSIONS_FILE_PREVIEW_WIDTH_MAX).toBe(860);

    // MIN < DEFAULT < MAX（usePanelWidth 夹取区间合法）。
    expect(SESSIONS_LEFT_PANEL_WIDTH_MIN).toBeLessThan(SESSIONS_LEFT_PANEL_WIDTH_DEFAULT);
    expect(SESSIONS_LEFT_PANEL_WIDTH_DEFAULT).toBeLessThan(SESSIONS_LEFT_PANEL_WIDTH_MAX);
    expect(SESSIONS_FILE_PREVIEW_WIDTH_MIN).toBeLessThan(SESSIONS_FILE_PREVIEW_WIDTH_DEFAULT);
    expect(SESSIONS_FILE_PREVIEW_WIDTH_DEFAULT).toBeLessThan(SESSIONS_FILE_PREVIEW_WIDTH_MAX);
  });
});
