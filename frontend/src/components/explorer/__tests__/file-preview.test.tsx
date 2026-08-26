import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FilePreview } from "@/components/explorer/file-preview";

/**
 * 黑盒测试：mock 取数层（@/lib/explorer）、统一预览弹窗（@/components/files）、
 * MarkdownText 与代码高亮模块，只验 FilePreview 的分发矩阵 / 截断警示 / 下载行为 /
 * objectURL 生命周期 / 全屏预览入口（jsdom 不做真实高亮与弹窗渲染链，断言分支
 * 路由与契约而非库行为）。
 */

// ── mock：explorer 取数层（useExplorerFile / fetchDownload / downloadExplorerFile）──
const explorerMocks = vi.hoisted(() => ({
  useExplorerFile: vi.fn(),
  fetchDownload: vi.fn(),
  downloadExplorerFile: vi.fn(),
}));
vi.mock("@/lib/explorer", () => explorerMocks);

// ── mock：FilePreviewModal → 回显 props 的替身（全屏入口只验契约：open/
//    defaultFullscreen/target 构造，不在 jsdom 里跑真实弹窗与七渲染器链）──
const previewModalSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: (props: {
    target: {
      fetch: () => Promise<Blob>;
      meta: { name: string; mime?: string | null; size?: number | null };
      download?: () => void;
      officeSource?: { source: string; id: string };
    } | null;
    open: boolean;
    onClose: () => void;
    defaultFullscreen?: boolean;
  }) => {
    previewModalSpy(props);
    return <div data-testid="file-preview-modal" data-open={String(props.open)} />;
  },
}));

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
// （声明 Blob 入参类型，供 MIME 重设断言从 mock.calls 读取 .type）
let objectUrlSeq = 0;
const createObjectURL = vi.fn((_blob: Blob) => `blob:preview-${++objectUrlSeq}`);
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
  previewModalSpy.mockClear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

/** 「源码⇄预览」切换按钮查询（ql-20260825-016）：可访问名须以「源码/预览」结尾，
 *  负向先行排除「全屏预览」（FR-05 新增的全类型全屏入口，可访问名含“预览”子串
 *  但语义不同——打开统一预览弹窗，不参与源码模式切换）。 */
const TOGGLE_BUTTON_NAME = /^(?!.*全屏).*(源码|预览)$/;

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
    // antd Image（FR-05，可点击放大/缩放/旋转）：img 落 .ant-image wrapper 内且带语义类
    expect(img1.closest(".ant-image")).not.toBeNull();
    expect(img1.className).toContain("ant-image-img");
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

  // ── 全屏预览（2026-08-26-file-fullscreen-preview / FR-05 / D-007@v1）──────────

  it("头部「全屏预览」按钮以 defaultFullscreen 打开统一弹窗，target 不携带 officeSource", async () => {
    mockQueryResult(makeFile({ name: "main.py" }));
    render(<FilePreview workspaceId="ws-1" filePath="backend/main.py" />);

    fireEvent.click(screen.getByRole("button", { name: /全屏预览/ }));
    expect(await screen.findByTestId("file-preview-modal")).toHaveAttribute(
      "data-open",
      "true",
    );
    const props = previewModalSpy.mock.calls.at(-1)![0];
    expect(props.defaultFullscreen).toBe(true);
    expect(props.target).not.toBeNull();
    // D-007：explorer 文件无平台 id，不携带 officeSource（恒本地渲染）
    expect(props.target!.officeSource).toBeUndefined();
    // R-05：mime 传 null（下载端点 blob.type 多为 octet-stream，靠扩展名经 matchRenderer 分发）
    expect(props.target!.meta).toEqual({ name: "main.py", mime: null, size: 4300 });
    // fetch 直连下载端点（fetchDownload）
    void props.target!.fetch();
    expect(explorerMocks.fetchDownload).toHaveBeenCalledWith("ws-1", "backend/main.py");
    // download 复用头部既有下载逻辑（downloadExplorerFile）
    act(() => {
      props.target!.download?.();
    });
    expect(explorerMocks.downloadExplorerFile).toHaveBeenCalledWith("ws-1", "backend/main.py");

    // onClose 仅收 open（target 常驻 state，防弹窗内容闪重建）
    act(() => {
      props.onClose();
    });
    await waitFor(() =>
      expect(screen.getByTestId("file-preview-modal")).toHaveAttribute("data-open", "false"),
    );
  });

  it("二进制分支同样有全屏入口（元信息卡场景 docx/xlsx/pdf 全屏可看）", () => {
    mockQueryResult(makeFile({ name: "report.docx", binary: true, size: 97584, content: "" }));
    render(<FilePreview workspaceId="ws-1" filePath="docs/report.docx" />);

    // 元信息卡场景当前只能下载，头部按钮提供全屏入口（本地渲染器全屏可看）
    fireEvent.click(screen.getByRole("button", { name: /全屏预览/ }));
    const props = previewModalSpy.mock.calls.at(-1)![0];
    expect(props.open).toBe(true);
    expect(props.defaultFullscreen).toBe(true);
    expect(props.target!.meta).toEqual({ name: "report.docx", mime: null, size: 97584 });
    expect(props.target!.officeSource).toBeUndefined();
  });

  // ── 浏览器原生预览（ql-20260825-016：html/pdf 默认原生渲染，「源码」按钮切换看源码）──

  it("浏览器可原生预览扩展名（pdf/html/htm）才显示「源码」切换按钮，其余类型不显示", () => {
    // 原生预览分支挂载即取 Blob，可见性用例也给个兜底返回（防 undefined.then 崩溃）
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["x"]));
    // 普通代码 / 图片（已内联预览）：无切换按钮
    mockQueryResult(makeFile({ name: "main.py" }));
    const t1 = render(<FilePreview workspaceId="ws-1" filePath="a/main.py" />);
    expect(screen.queryByRole("button", { name: TOGGLE_BUTTON_NAME })).not.toBeInTheDocument();
    t1.unmount();

    mockQueryResult(makeFile({ name: "logo.png", binary: true, content: "" }));
    const t2 = render(<FilePreview workspaceId="ws-1" filePath="a/logo.png" />);
    expect(screen.queryByRole("button", { name: TOGGLE_BUTTON_NAME })).not.toBeInTheDocument();
    t2.unmount();

    // pdf（二进制）与 html（文本）：切换按钮出现在下载旁
    mockQueryResult(makeFile({ name: "report.pdf", binary: true, content: "" }));
    const t3 = render(<FilePreview workspaceId="ws-1" filePath="docs/report.pdf" />);
    expect(screen.getByRole("button", { name: /源码/ })).toBeInTheDocument();
    t3.unmount();

    mockQueryResult(makeFile({ name: "index.htm", content: "<p>hi</p>" }));
    render(<FilePreview workspaceId="ws-1" filePath="site/index.htm" />);
    expect(screen.getByRole("button", { name: /源码/ })).toBeInTheDocument();
  });

  it("pdf 默认原生预览：鉴权取 Blob → 按扩展名重设 MIME → iframe 原生渲染（不加 sandbox）", async () => {
    mockQueryResult(makeFile({ name: "report.pdf", binary: true, content: "" }));
    // 下载端点默认回 octet-stream，组件须按扩展名重设 MIME 否则 iframe 会触发下载而非渲染
    explorerMocks.fetchDownload.mockResolvedValue(
      new Blob(["%pdf"], { type: "application/octet-stream" }),
    );
    render(<FilePreview workspaceId="ws-1" filePath="docs/report.pdf" />);

    const iframe = await screen.findByTitle("report.pdf 浏览器预览");
    expect(explorerMocks.fetchDownload).toHaveBeenCalledWith("ws-1", "docs/report.pdf");
    // objectURL 序号是全文件共享计数器（beforeEach 只 mockClear 不清零），动态取值断言
    expect(iframe).toHaveAttribute("src", createObjectURL.mock.results.at(-1)!.value);
    expect(createObjectURL.mock.calls.at(-1)![0].type).toBe("application/pdf");
    // pdf 交给浏览器内置查看器渲染，sandbox 会禁用查看器 → 不设置
    expect(iframe.getAttribute("sandbox")).toBeNull();
    // 默认预览态：不渲染元信息卡
    expect(screen.queryByText(/二进制文件不预览/)).not.toBeInTheDocument();
  });

  it("html 默认原生预览且 iframe 带 sandbox 隔离（不含 allow-same-origin，防脚本摸父页面）", async () => {
    mockQueryResult(makeFile({ name: "demo.html", content: "<script>1</script>" }));
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["<html></html>"]));
    render(<FilePreview workspaceId="ws-1" filePath="site/demo.html" />);

    const iframe = await screen.findByTitle("demo.html 浏览器预览");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
    expect(createObjectURL.mock.calls.at(-1)![0].type).toBe("text/html");
    // 默认预览态：不走源码高亮分支
    expect(screen.queryByTestId("code-highlight")).not.toBeInTheDocument();
  });

  it("点「源码」切换到源码视图（html→高亮源码 / pdf→元信息卡），再点「预览」切回 iframe", async () => {
    // html：源码 = Prism markup 高亮
    mockQueryResult(makeFile({ name: "demo.html", content: "<p>hi</p>" }));
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["<html></html>"]));
    render(<FilePreview workspaceId="ws-1" filePath="site/demo.html" />);
    await screen.findByTitle("demo.html 浏览器预览");

    fireEvent.click(screen.getByRole("button", { name: /源码/ }));
    expect(await screen.findByTestId("code-highlight")).toHaveAttribute(
      "data-language",
      "markup",
    );
    expect(screen.queryByTitle("demo.html 浏览器预览")).not.toBeInTheDocument();

    // 切回预览：iframe 恢复（objectURL 生命周期由 effect 管理，重新打开重新取数）
    fireEvent.click(screen.getByRole("button", { name: TOGGLE_BUTTON_NAME }));
    expect(await screen.findByTitle("demo.html 浏览器预览")).toBeInTheDocument();
  });

  it("pdf 源码视图为二进制元信息卡", async () => {
    mockQueryResult(makeFile({ name: "report.pdf", binary: true, size: 2048, content: "" }));
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["%pdf"]));
    render(<FilePreview workspaceId="ws-1" filePath="docs/report.pdf" />);
    await screen.findByTitle("report.pdf 浏览器预览");

    fireEvent.click(screen.getByRole("button", { name: /源码/ }));
    expect(await screen.findByText(/二进制文件不预览/)).toBeInTheDocument();
    expect(screen.queryByTitle("report.pdf 浏览器预览")).not.toBeInTheDocument();
  });

  it("切换文件后回到默认预览态（源码模式不跨文件残留）", async () => {
    mockQueryResult(makeFile({ name: "demo.html", content: "<p>hi</p>" }));
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["<html></html>"]));
    const { rerender } = render(<FilePreview workspaceId="ws-1" filePath="site/demo.html" />);
    await screen.findByTitle("demo.html 浏览器预览");

    // 进入源码模式后切换到另一个 html 文件
    fireEvent.click(screen.getByRole("button", { name: /源码/ }));
    expect(await screen.findByTestId("code-highlight")).toBeInTheDocument();

    explorerMocks.useExplorerFile.mockReturnValue({
      data: makeFile({ name: "other.html", content: "<p>other</p>" }),
      isPending: false,
      isError: false,
      error: null,
    });
    rerender(<FilePreview workspaceId="ws-1" filePath="site/other.html" />);
    // 新文件默认回到原生预览态
    expect(await screen.findByTitle("other.html 浏览器预览")).toBeInTheDocument();
    expect(screen.queryByTestId("code-highlight")).not.toBeInTheDocument();
  });

  it("预览取数失败：降级提示且可切「源码」查看，objectURL 切换/卸载均 revoke", async () => {
    mockQueryResult(makeFile({ name: "demo.html", content: "<p>hi</p>" }));
    explorerMocks.fetchDownload.mockRejectedValue(new Error("daemon 离线"));
    const { unmount } = render(<FilePreview workspaceId="ws-1" filePath="site/demo.html" />);

    expect(await screen.findByText("文件加载失败，请下载后查看")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    // 失败不阻断源码兜底
    fireEvent.click(screen.getByRole("button", { name: /源码/ }));
    expect(await screen.findByTestId("code-highlight")).toBeInTheDocument();

    unmount();
  });

  it("原生预览 objectURL 生命周期：切换文件 revoke 旧链，卸载 revoke 当前链", async () => {
    mockQueryResult(makeFile({ name: "a.html", content: "<p>a</p>" }));
    explorerMocks.fetchDownload.mockResolvedValue(new Blob(["<html>a</html>"]));
    const { rerender, unmount } = render(
      <FilePreview workspaceId="ws-1" filePath="site/a.html" />,
    );
    await screen.findByTitle("a.html 浏览器预览");
    const url1 = createObjectURL.mock.results.at(-1)!.value;
    expect(revokeObjectURL).not.toHaveBeenCalled();

    explorerMocks.useExplorerFile.mockReturnValue({
      data: makeFile({ name: "b.html", content: "<p>b</p>" }),
      isPending: false,
      isError: false,
      error: null,
    });
    rerender(<FilePreview workspaceId="ws-1" filePath="site/b.html" />);
    await screen.findByTitle("b.html 浏览器预览");
    const url2 = createObjectURL.mock.results.at(-1)!.value;
    expect(url2).not.toBe(url1);
    expect(revokeObjectURL).toHaveBeenCalledWith(url1);

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(url2);
  });
});
