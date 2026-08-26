import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// vi.mock 解耦后端（task-15 / FR-09）；fetchChangeFileRaw 为 raw 端点取数
// （2026-08-26-file-fullscreen-preview task-02 / D-009：预览恒走 raw 不走 content）
vi.mock("@/lib/change-files", () => ({
  buildChangeFileTree: (items: { path: string; name: string; is_text: boolean }[]) =>
    items.map((i) => ({ name: i.name, path: i.path, children: [], doc: i })),
  listChangeFiles: vi.fn(),
  getChangeFileContent: vi.fn(),
  saveChangeFileContent: vi.fn(),
  listPendingChangeFiles: vi.fn(),
  fetchChangeFileRaw: vi.fn(),
}));

// FilePreviewModal 浅 mock：弹窗本体（antd Modal + 渲染器树）已有专属测试
// （files/__tests__/file-preview-modal.test.tsx），此处只验接线——捕获 props
// 断言 open/defaultFullscreen/target 契约，open=false 时渲染 null
interface CapturedModalProps {
  open: boolean;
  defaultFullscreen?: boolean;
  target: {
    fetch: () => Promise<Blob>;
    meta: { name: string; mime?: string | null; size?: number | null };
  } | null;
  onClose: () => void;
}
const modalProps = vi.hoisted(() => [] as CapturedModalProps[]);
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: (props: CapturedModalProps) => {
    modalProps.push(props);
    return props.open ? <div data-testid="file-preview-modal" /> : null;
  },
}));

// jsdom 未实现 URL.createObjectURL/revokeObjectURL——内联图片走真实 useObjectUrl，
// 用可控替身供断言（参照 explorer/__tests__/file-preview.test.tsx 先例）
const createObjectURL = vi.fn(() => "blob:mock-image");
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

// MarkdownPreview jsdom 降级（CONVENTIONS 已知坑）；task-13 起文件预览必须挂
// 统一 sanitize 插件，mock 捕获 rehypePlugins 供断言
const previewCalls = vi.hoisted(() => [] as Array<{ source?: string; rehypePlugins?: unknown }>);
vi.mock("@uiw/react-markdown-preview", () => ({
  __esModule: true,
  default: (props: { source: string; rehypePlugins?: unknown }) => {
    previewCalls.push(props);
    return <div data-testid="md">{props.source}</div>;
  },
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangeFileTree } from "@/components/change-file-tree";
import { markdownRehypePlugins } from "@/components/ui/markdown-text";
import {
  listChangeFiles,
  getChangeFileContent,
  saveChangeFileContent,
  listPendingChangeFiles,
  fetchChangeFileRaw,
} from "@/lib/change-files";

const mockedListChangeFiles = vi.mocked(listChangeFiles);
const mockedGetContent = vi.mocked(getChangeFileContent);
const mockedSave = vi.mocked(saveChangeFileContent);
const mockedPending = vi.mocked(listPendingChangeFiles);
const mockedFetchRaw = vi.mocked(fetchChangeFileRaw);

beforeEach(() => {
  vi.clearAllMocks();
  mockedListChangeFiles.mockResolvedValue({
    change_id: "c1",
    items: [
      { path: "proposal.md", name: "proposal.md", size: 10, last_modified_at: null, is_text: true },
      { path: "logo.png", name: "logo.png", size: 100, last_modified_at: null, is_text: false },
    ],
  });
  mockedPending.mockResolvedValue({ items: [] });
  mockedGetContent.mockResolvedValue({ path: "proposal.md", content: "原文", exists: true });
  mockedSave.mockResolvedValue({ status: "done" });
  mockedFetchRaw.mockResolvedValue(new Blob(["image-bytes"], { type: "image/png" }));
});

describe("ChangeFileTree", () => {
  it("渲染文件树列出全部文件", async () => {
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("proposal.md")).toBeInTheDocument());
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument(); // 二进制只读徽标
  });

  it("默认进入预览模式；点「编辑」才进入文本编辑并保存", async () => {
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("proposal.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("proposal.md"));
    // 默认预览：Markdown 渲染出现，编辑框未出现
    await waitFor(() => expect(screen.getByTestId("md")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("原文")).not.toBeInTheDocument();
    // task-13：markdown 预览必须挂统一 sanitize 插件（XSS 防线不可漏）
    const last = previewCalls.at(-1);
    expect(last?.rehypePlugins).toBe(markdownRehypePlugins);
    // 点编辑进入编辑模式
    fireEvent.click(screen.getByText("编辑"));
    await waitFor(() => expect(screen.getByDisplayValue("原文")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue("原文"), { target: { value: "改后" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith("ws", "c1", "proposal.md", "改后"));
  });

  it("pending 文件显示排队中徽标", async () => {
    mockedPending.mockResolvedValue({
      items: [{ path: "proposal.md", status: "pending", created_at: "2026-07-02T00:00:00Z" }],
    });
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("排队中")).toBeInTheDocument());
  });

  it("html 文件默认预览模式直接渲染 iframe（sandbox 隔离）", async () => {
    mockedListChangeFiles.mockResolvedValue({
      change_id: "c1",
      items: [
        { path: "prototype-search.html", name: "prototype-search.html", size: 30, last_modified_at: null, is_text: true },
      ],
    });
    mockedGetContent.mockResolvedValue({ path: "prototype-search.html", content: "<h1>原型</h1>", exists: true });
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("prototype-search.html")).toBeInTheDocument());
    fireEvent.click(screen.getByText("prototype-search.html"));
    const frame = await waitFor(() => screen.getByTitle("prototype-search.html 渲染预览") as HTMLIFrameElement);
    // 不含 allow-same-origin：脚本可跑但隔离在唯一源，无法访问父页面
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
    expect(frame.getAttribute("srcdoc")).toBe("<h1>原型</h1>");
  });

  it("纯文本文件默认预览只读源码，点「编辑」进入编辑框", async () => {
    mockedListChangeFiles.mockResolvedValue({
      change_id: "c1",
      items: [
        { path: "config.yaml", name: "config.yaml", size: 10, last_modified_at: null, is_text: true },
      ],
    });
    mockedGetContent.mockResolvedValue({ path: "config.yaml", content: "key: value", exists: true });
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("config.yaml")).toBeInTheDocument());
    fireEvent.click(screen.getByText("config.yaml"));
    // 默认预览：只读源码显示，编辑框未出现
    await waitFor(() => expect(screen.getByText("key: value")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("key: value")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("编辑"));
    await waitFor(() => expect(screen.getByDisplayValue("key: value")).toBeInTheDocument());
  });

  it("编辑后点「预览」切回，渲染最新未保存内容（不丢改动）", async () => {
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("proposal.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("proposal.md"));
    await waitFor(() => expect(screen.getByTestId("md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("编辑"));
    fireEvent.change(screen.getByDisplayValue("原文"), { target: { value: "改后" } });
    fireEvent.click(screen.getByText("预览"));
    await waitFor(() => expect(screen.getByTestId("md")).toHaveTextContent("改后"));
  });

  // ql-20260816-005：空树不是终点——新建 change 文件镜像滞后期间给同步指引
  it("文件清单为空时显示暂无文件 + 镜像未同步指引", async () => {
    mockedListChangeFiles.mockResolvedValue({ change_id: "c1", items: [] });
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("暂无文件")).toBeInTheDocument());
    expect(screen.getByText(/尚未同步到平台镜像/)).toBeInTheDocument();
    expect(screen.getByText(/同步到服务器/)).toBeInTheDocument();
  });

  // ── 2026-08-26-file-fullscreen-preview / FR-03：非文本态 + 全屏预览 ──────

  it("选中图片文件内联 antd Image（鉴权 objectURL），取数走 raw 端点而非 content", async () => {
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());
    fireEvent.click(screen.getByText("logo.png"));
    // 内联 antd Image（img 元素）出现，src 为 useObjectUrl 构造的 objectURL
    const img = await waitFor(() => screen.getByRole("img"));
    expect(img).toHaveAttribute("src", "blob:mock-image");
    expect(img).toHaveAttribute("alt", "logo.png");
    // D-009：图片取数恒走 raw 端点，不调 content 端点
    expect(mockedFetchRaw).toHaveBeenCalledWith("ws", "c1", "logo.png");
    expect(mockedGetContent).not.toHaveBeenCalled();
    // 切换到其他文件：objectURL 自动 revoke（useObjectUrl 卸载清理）
    fireEvent.click(screen.getByText("proposal.md"));
    await waitFor(() => expect(screen.getByTestId("md")).toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-image");
  });

  it("选中非图片非文本文件显示文件卡片 + 全屏预览按钮（替代暂不支持占位）", async () => {
    mockedListChangeFiles.mockResolvedValue({
      change_id: "c1",
      items: [
        { path: "docs/spec.pdf", name: "spec.pdf", size: 2048, last_modified_at: null, is_text: false },
      ],
    });
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());
    fireEvent.click(screen.getByText("spec.pdf"));
    // 文件卡片：名称 + 大小（formatFileSize）+ 全屏预览按钮
    await waitFor(() => expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument());
    expect(screen.queryByText(/暂不支持预览/)).not.toBeInTheDocument();
    // 非图片不预拉字节（卡片仅元信息，字节由弹窗按需拉取）
    expect(mockedFetchRaw).not.toHaveBeenCalled();
    // 卡片按钮打开统一弹窗：defaultFullscreen 且 meta 携带名称/大小
    fireEvent.click(screen.getByRole("button", { name: "全屏预览" }));
    await waitFor(() => expect(screen.getByTestId("file-preview-modal")).toBeInTheDocument());
    const props = modalProps.at(-1)!;
    expect(props.open).toBe(true);
    expect(props.defaultFullscreen).toBe(true);
    expect(props.target?.meta).toEqual({ name: "spec.pdf", mime: null, size: 2048 });
  });

  it("文本文件点工具栏「全屏预览」：弹窗 defaultFullscreen 打开且 fetch 恒走 raw 端点", async () => {
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("proposal.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("proposal.md"));
    await waitFor(() => expect(screen.getByTestId("md")).toBeInTheDocument());
    // 初始未打开
    expect(screen.queryByTestId("file-preview-modal")).not.toBeInTheDocument();
    // 选中文本文件时已取 1 次 content（编辑取数路径，非预览）
    expect(mockedGetContent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "全屏预览" }));
    await waitFor(() => expect(screen.getByTestId("file-preview-modal")).toBeInTheDocument());
    const props = modalProps.at(-1)!;
    expect(props.open).toBe(true);
    expect(props.defaultFullscreen).toBe(true);
    expect(props.target?.meta).toEqual({ name: "proposal.md", mime: null, size: 10 });
    // target.fetch 恒为 fetchChangeFileRaw（D-009：预览不走 content 端点，
    // 文本同样走 raw，规避 content 端点 1MB 截断）
    await props.target!.fetch();
    expect(mockedFetchRaw).toHaveBeenCalledWith("ws", "c1", "proposal.md");
    // 打开弹窗不新增 content 端点调用（预览取数与编辑取数分离）
    expect(mockedGetContent).toHaveBeenCalledTimes(1);
  });
});
