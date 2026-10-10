// task-02（2026-10-09-attachment-inline-reference）：InlineAttRefText 历史渲染单测。
// 覆盖：无引用文本原样直出（本变更前消息渲染逐字不变）、引用段标签渲染与点击
// 回调、onOpenRef 缺省不可点击、混排拆段正确。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InlineAttRefText } from "@/components/daemon/attachment-ref-tag";

const UUID = "aaaaaaaa-1111-2222-3333-444444444444";

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
