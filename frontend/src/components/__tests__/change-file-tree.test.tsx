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

  it("选中文本文件显示 textarea 内容，保存触发 saveChangeFileContent", async () => {
    render(<ChangeFileTree workspaceId="ws" changeId="c1" />);
    await waitFor(() => expect(screen.getByText("proposal.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("proposal.md"));
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
});
