// task-02（2026-10-09-attachment-inline-reference）：InlineAttRefText 历史渲染单测。
// 覆盖：无引用文本原样直出（本变更前消息渲染逐字不变）、引用段标签渲染与点击
// 回调、onOpenRef 缺省不可点击、混排拆段正确。
// 2026-10-10-workspace-ref-intake task-09：三类工作区标记标签 + fetchDownload 预览。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InlineAttRefText, InlineAttRefTextWithPreview } from "@/components/daemon/attachment-ref-tag";

// mock @/lib/explorer 的 fetchDownload（预览 fetch 链断言面）与
// @/components/files/file-preview-modal（回显 props 的替身，attachment-chips 同款）。
vi.mock("@/lib/explorer", () => ({
  fetchDownload: vi.fn(async () => new Blob(["x"])),
}));
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: (props: {
    open: boolean;
    target?: { fetch: () => Promise<Blob> } | null;
  }) => (
    <div data-testid="preview-modal" data-open={String(props.open)}>
      <button
        type="button"
        data-testid="preview-modal-fetch"
        onClick={() => void props.target?.fetch()}
      />
    </div>
  ),
}));
import { fetchDownload } from "@/lib/explorer";
const fetchDownloadMock = fetchDownload as unknown as ReturnType<typeof vi.fn>;

const UUID = "aaaaaaaa-1111-2222-3333-444444444444";
const WID = "cccccccc-1111-2222-3333-444444444444";

describe("InlineAttRefText（FR-06 历史引用渲染）", () => {
  it("无引用文本原样直出（单 text 节点，与现状渲染一致）", () => {
    const { container } = render(<InlineAttRefText text="普通正文，无引用" />);
    expect(container.textContent).toBe("普通正文，无引用");
    expect(container.querySelector("button")).toBeNull();
  });

  it("引用段渲染标签并点击回调携 uuid 与文件名", () => {
    const onOpenRef = vi.fn();
    render(
      <InlineAttRefText
        text={`看这张[附件引用:${UUID}|截图.png]的效果`}
        onOpenRef={onOpenRef}
      />,
    );
    const tag = screen.getByTitle("截图.png（点击在线预览）");
    fireEvent.click(tag);
    expect(onOpenRef).toHaveBeenCalledWith({ id: UUID, name: "截图.png" });
  });

  it("onOpenRef 缺省：标签渲染但 disabled 不可点击", () => {
    render(<InlineAttRefText text={`[附件引用:${UUID}|日志.txt]`} />);
    const tag = screen.getByTitle("日志.txt（点击在线预览）") as HTMLButtonElement;
    expect(tag.disabled).toBe(true);
  });

  it("混排拆段：text 段原样 + 多引用标签各自渲染", () => {
    const UUID2 = "bbbbbbbb-1111-2222-3333-444444444444";
    const { container } = render(
      <InlineAttRefText
        text={`一[附件引用:${UUID}|A.png]二[附件引用:${UUID2}|B.png]三`}
        onOpenRef={() => {}}
      />,
    );
    expect(container.textContent).toContain("一");
    expect(container.textContent).toContain("二");
    expect(container.textContent).toContain("三");
    expect(screen.getByTitle("A.png（点击在线预览）")).toBeInTheDocument();
    expect(screen.getByTitle("B.png（点击在线预览）")).toBeInTheDocument();
  });
});

describe("InlineAttRefText 三类工作区标记（workspace-ref-intake task-09）", () => {
  it("file/dir/code 三类标签渲染（图标 + 名称 + 行号段）并点击回调 onOpenWsRef", () => {
    const onOpenWsRef = vi.fn();
    render(
      <InlineAttRefText
        text={`文件[文件引用:${WID}|docs/design.md]目录[目录引用:${WID}|]代码[代码引用:${WID}|src/a.py|L10-L16]`}
        onOpenWsRef={onOpenWsRef}
      />,
    );
    const fileTag = screen.getByTitle(`文件：docs/design.md（点击预览）`);
    expect(fileTag.textContent).toBe("design.md");
    const dirTag = screen.getByTitle(`目录：工作区根（点击预览）`);
    expect(dirTag.textContent).toBe("工作区根");
    const codeTag = screen.getByTitle(`代码：src/a.py 第 10-16 行（点击预览）`);
    expect(codeTag.textContent).toBe("a.py:10-16");
    // 图标按 kind 渲染（lucide svg class）
    expect(fileTag.querySelector("svg")!.getAttribute("class")).toContain("lucide-file-text");
    expect(dirTag.querySelector("svg")!.getAttribute("class")).toContain("lucide-folder");
    expect(codeTag.querySelector("svg")!.getAttribute("class")).toContain("lucide-braces");
    fireEvent.click(fileTag);
    expect(onOpenWsRef).toHaveBeenCalledWith({
      workspaceId: WID,
      path: "docs/design.md",
      lines: undefined,
    });
    fireEvent.click(codeTag);
    expect(onOpenWsRef).toHaveBeenCalledWith({
      workspaceId: WID,
      path: "src/a.py",
      lines: [10, 16],
    });
  });

  it("onOpenWsRef 缺省：三类标签 disabled；附件与工作区回调互不串", () => {
    render(
      <InlineAttRefText
        text={`[文件引用:${WID}|a.md][附件引用:${UUID}|x.png]`}
        onOpenRef={() => {}}
      />,
    );
    const wsTag = screen.getByTitle(`文件：a.md（点击预览）`) as HTMLButtonElement;
    expect(wsTag.disabled).toBe(true);
    const attTag = screen.getByTitle("x.png（点击在线预览）") as HTMLButtonElement;
    expect(attTag.disabled).toBe(false);
  });

  it("解析失败片段原样文本（容错不丢字）", () => {
    const bad = `坏[文件引用:${WID}|a|b.md]尾`;
    const { container } = render(<InlineAttRefText text={bad} onOpenWsRef={() => {}} />);
    expect(container.textContent).toBe(bad);
    expect(container.querySelector("button")).toBeNull();
  });

  it("InlineAttRefTextWithPreview：工作区引用点击开预览（fetch=fetchDownload）", async () => {
    render(<InlineAttRefTextWithPreview text={`看[代码引用:${WID}|src/a.py|L3-L5]`} />);
    fireEvent.click(screen.getByTitle(`代码：src/a.py 第 3-5 行（点击预览）`));
    await waitFor(() =>
      expect(screen.getByTestId("preview-modal")).toHaveAttribute("data-open", "true"),
    );
    // fetch 惰性（真实 Modal 打开时拉取）——替身按钮手动触发断言绑定。
    fireEvent.click(screen.getByTestId("preview-modal-fetch"));
    expect(fetchDownloadMock).toHaveBeenCalledWith(WID, "src/a.py");
  });

  it("根目录引用（path 空串）点击不开预览（无文件可取）", () => {
    render(<InlineAttRefTextWithPreview text={`[目录引用:${WID}|]`} />);
    fireEvent.click(screen.getByTitle(`目录：工作区根（点击预览）`));
    expect(screen.getByTestId("preview-modal")).toHaveAttribute("data-open", "false");
    expect(fetchDownloadMock).not.toHaveBeenCalled();
  });
});
