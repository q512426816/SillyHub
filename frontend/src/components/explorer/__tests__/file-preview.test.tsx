import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FilePreview } from "@/components/explorer/file-preview";

/**
 * 黑盒测试：mock 取数层（@/lib/explorer）、MarkdownText 与代码高亮模块，
 * 只验 FilePreview 的分发矩阵 / 截断警示 / 下载行为 / objectURL 生命周期
 * （jsdom 不做真实高亮与 markdown 解析，断言分支路由而非库行为）。
 */

// ── mock：explorer 取数层（useExplorerFile / fetchDownload / downloadExplorerFile）──
const explorerMocks = vi.hoisted(() => ({
  useExplorerFile: vi.fn(),
  fetchDownload: vi.fn(),
  downloadExplorerFile: vi.fn(),
}));
vi.mock("@/lib/explorer", () => explorerMocks);

// ── mock：MarkdownText → 纯文本（next/dynamic 在 jsdom 下渲染 null，见 memory）──
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content, size }: { content: string; size?: string }) => (
    <div data-testid="markdown-text" data-size={size}>
      {content}
    </div>
  ),
}));

// ── mock：Prism Light 高亮器（dynamic loader 的装载目标；jsdom 不做真实高亮）──
const highlighter = vi.hoisted(() => ({ registerLanguage: vi.fn() }));
vi.mock("react-syntax-highlighter/dist/esm/prism-light", () => {
  const Highlighter = (props: { language?: string; children?: ReactNode }) => (
    <pre data-testid="code-highlight" data-language={props.language}>
      <code>{props.children}</code>
    </pre>
  );
  Highlighter.registerLanguage = highlighter.registerLanguage;
  return { default: Highlighter };
});

// jsdom 未实现 URL.createObjectURL/revokeObjectURL——用可控替身追踪生命周期
let objectUrlSeq = 0;
const createObjectURL = vi.fn(() => `blob:preview-${++objectUrlSeq}`);
const revokeObjectURL = vi.fn();

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    writable: true,
    configurable: true,
  });
});

/** explorer file 响应形状（对齐 ExplorerFileResponse 生成 schema）。 */
interface FileData {
  name: string;
  size: number;
  mtime: string;
  binary: boolean;
  truncated: boolean;
  content: string;
}

function makeFile(partial: Partial<FileData>): FileData {
  return {
    name: "main.py",
    size: 4300,
    mtime: "2026-08-15T10:00:00Z",
    binary: false,
    truncated: false,
    content: "print('hi')",
    ...partial,
  };
}

/** 设定 useExplorerFile 的当前返回（组件只读 data/isPending/isError/error 四字段）。 */
function mockQueryResult(data: FileData | null, opts?: { pending?: boolean; error?: string }) {
  explorerMocks.useExplorerFile.mockReturnValue({
    data,
    isPending: opts?.pending ?? false,
    isError: opts?.error != null,
    error: opts?.error != null ? { message: opts.error } : null,
  });
}

beforeEach(() => {
  explorerMocks.fetchDownload.mockReset();
  explorerMocks.downloadExplorerFile.mockReset();
  explorerMocks.downloadExplorerFile.mockResolvedValue(undefined);
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe("FilePreview", () => {
  it("filePath=null 显示空态占位，透传 null 给 useExplorerFile", () => {
    mockQueryResult(null);
    render(<FilePreview workspaceId="ws-1" filePath={null} />);
    expect(screen.getByText("在左侧选择文件查看内容")).toBeInTheDocument();
    expect(explorerMocks.useExplorerFile).toHaveBeenCalledWith("ws-1", null);
  });

  it("加载中显示 Spin", () => {
    mockQueryResult(null, { pending: true });
    const { container } = render(<FilePreview workspaceId="ws-1" filePath="a.py" />);
    expect(container.querySelector(".ant-spin")).not.toBeNull();
  });

  it("加载失败显示红条并透传 ApiError 中文文案", () => {
    mockQueryResult(null, { error: "工作区守护进程离线，无法读取文件" });
    render(<FilePreview workspaceId="ws-1" filePath="a.py" />);
    expect(screen.getByRole("alert")).toHaveTextContent("工作区守护进程离线，无法读取文件");
  });

  it("md 文件复用 MarkdownText（size=reading），头部含名称/大小/修改时间与下载按钮", async () => {
    mockQueryResult(makeFile({ name: "README.md", content: "# 标题", size: 4300 }));
    render(<FilePreview workspaceId="ws-1" filePath="docs/README.md" />);

    const md = await screen.findByTestId("markdown-text");
    expect(md).toHaveTextContent("# 标题");
    expect(md).toHaveAttribute("data-size", "reading");

    // 头部：文件名 + 大小 + 修改时间（zh-CN）+ 下载按钮
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText(/4\.2 KB/)).toBeInTheDocument();
    expect(
      screen.getByText(
        `4.2 KB · 修改于 ${new Date("2026-08-15T10:00:00Z").toLocaleString("zh-CN")}`,
      ),
    ).toBeInTheDocument();
    // 图标带 aria-label="download"，可访问名拼接为「download 下载」→ 用子串匹配
    expect(screen.getByRole("button", { name: /下载/ })).toBeInTheDocument();
  });

  it("图片文件经 fetchDownload 取 Blob 渲染 objectURL，切换与卸载均 revoke", async () => {
    mockQueryResult(makeFile({ name: "logo.png", binary: true, content: "" }));
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["x"], { type: "image/png" }));

    const { rerender, unmount } = render(
      <FilePreview workspaceId="ws-1" filePath="docs/logo.png" />,
    );
    const img1 = await screen.findByRole("img", { name: "logo.png" });
    expect(img1).toHaveAttribute("src", "blob:preview-1");
    expect(explorerMocks.fetchDownload).toHaveBeenCalledWith("ws-1", "docs/logo.png");

    // 切换文件：旧 objectURL revoke、新文件重新取 Blob
    explorerMocks.useExplorerFile.mockReturnValue({
      data: makeFile({ name: "banner.svg", binary: true, content: "" }),
      isPending: false,
      isError: false,
      error: null,
    });
    rerender(<FilePreview workspaceId="ws-1" filePath="assets/banner.svg" />);
    const img2 = await screen.findByRole("img", { name: "banner.svg" });
    expect(img2).toHaveAttribute("src", "blob:preview-2");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");

    // 卸载：当前 objectURL revoke
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
  });

  it("binary 文件渲染元信息卡（名称/大小/修改时间 + 二进制提示），不渲染内容", () => {
    mockQueryResult(makeFile({ name: "app.exe", binary: true, size: 4404_019, content: "" }));
    render(<FilePreview workspaceId="ws-1" filePath="bin/app.exe" />);

    expect(screen.getByText(/二进制文件不预览/)).toBeInTheDocument();
    expect(screen.getByText("大小：4.2 MB")).toBeInTheDocument();
    expect(
      screen.getByText(`修改时间：${new Date("2026-08-15T10:00:00Z").toLocaleString("zh-CN")}`),
    ).toBeInTheDocument();
    // 头部与元信息卡各出现一次文件名
    expect(screen.getAllByText("app.exe").length).toBe(2);
    // 元信息卡场景下载按钮仍可用
    expect(screen.getByRole("button", { name: /下载/ })).toBeInTheDocument();
    // 不做代码高亮 / 不做 objectURL 内联
    expect(screen.queryByTestId("code-highlight")).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("truncated=true 顶部黄条提示截断并引导下载（未识别扩展名退化纯文本 pre）", () => {
    mockQueryResult(
      makeFile({ name: "server.log", truncated: true, content: "line1\nline2" }),
    );
    const { container } = render(
      <FilePreview workspaceId="ws-1" filePath="logs/server.log" />,
    );

    expect(screen.getByText(/文件超过 10MB，仅显示前 10MB/)).toBeInTheDocument();
    // .log 不在语言映射表 → 纯文本 pre 兜底（原始内容直出，不经任何解析）
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("line1\nline2");
    expect(screen.queryByTestId("code-highlight")).not.toBeInTheDocument();
  });

  it("代码文件走 Prism 高亮分支并按扩展名映射语言（py→python）", async () => {
    mockQueryResult(makeFile({ name: "main.py", content: "print('hi')" }));
    render(<FilePreview workspaceId="ws-1" filePath="backend/main.py" />);

    const code = await screen.findByTestId("code-highlight");
    expect(code).toHaveAttribute("data-language", "python");
    expect(code).toHaveTextContent("print('hi')");
  });

  it("tsx 文件映射到 tsx 语言（映射表覆盖前端常用后缀）", async () => {
    mockQueryResult(makeFile({ name: "card.tsx", content: "<div />" }));
    render(<FilePreview workspaceId="ws-1" filePath="src/card.tsx" />);
    expect(await screen.findByTestId("code-highlight")).toHaveAttribute("data-language", "tsx");
  });

  it("点击下载调用 downloadExplorerFile，loading 态防重复点击", async () => {
    let release: () => void = () => {};
    explorerMocks.downloadExplorerFile.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    mockQueryResult(makeFile({ name: "main.py" }));
    render(<FilePreview workspaceId="ws-1" filePath="backend/main.py" />);

    const btn = screen.getByRole("button", { name: /下载/ });
    fireEvent.click(btn);
    fireEvent.click(btn); // loading 中再点不重复触发
    expect(explorerMocks.downloadExplorerFile).toHaveBeenCalledTimes(1);
    expect(explorerMocks.downloadExplorerFile).toHaveBeenCalledWith("ws-1", "backend/main.py");

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /下载/ })).not.toBeDisabled(),
    );
  });

  it("下载失败显示内联失败提示且可再次点击", async () => {
    explorerMocks.downloadExplorerFile.mockRejectedValue(new Error("boom"));
    mockQueryResult(makeFile({ name: "main.py" }));
    render(<FilePreview workspaceId="ws-1" filePath="backend/main.py" />);

    fireEvent.click(screen.getByRole("button", { name: /下载/ }));
    expect(await screen.findByText("下载失败，请重试")).toBeInTheDocument();

    // 失败后按钮恢复可点（loading 已复位）
    const btn = screen.getByRole("button", { name: /下载/ });
    await waitFor(() => expect(btn).not.toBeDisabled());
    explorerMocks.downloadExplorerFile.mockResolvedValue(undefined);
    fireEvent.click(btn);
    await waitFor(() =>
      expect(explorerMocks.downloadExplorerFile).toHaveBeenCalledTimes(2),
    );
  });
});
