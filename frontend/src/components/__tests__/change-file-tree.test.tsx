import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock 解耦后端（task-15 / FR-09）
vi.mock("@/lib/change-files", () => ({
  buildChangeFileTree: (items: { path: string; name: string; is_text: boolean }[]) =>
    items.map((i) => ({ name: i.name, path: i.path, children: [], doc: i })),
  listChangeFiles: vi.fn(),
  getChangeFileContent: vi.fn(),
  saveChangeFileContent: vi.fn(),
  listPendingChangeFiles: vi.fn(),
}));

// MarkdownPreview jsdom 降级（CONVENTIONS 已知坑）
vi.mock("@uiw/react-markdown-preview", () => ({
  __esModule: true,
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangeFileTree } from "@/components/change-file-tree";
import {
  listChangeFiles,
  getChangeFileContent,
  saveChangeFileContent,
  listPendingChangeFiles,
} from "@/lib/change-files";

const mockedListChangeFiles = vi.mocked(listChangeFiles);
const mockedGetContent = vi.mocked(getChangeFileContent);
const mockedSave = vi.mocked(saveChangeFileContent);
const mockedPending = vi.mocked(listPendingChangeFiles);

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
});
