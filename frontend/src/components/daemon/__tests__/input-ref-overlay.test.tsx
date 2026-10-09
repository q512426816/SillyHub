// task-02（2026-10-09-attachment-inline-reference）：InputRefOverlay 镜像层单测。
// 覆盖：空 tokens 不渲染（零回归门）、token 段背景块与角标渲染、× 角标点击回调
// 与事件不外溢、多 token/重复出现拆分正确。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InputRefOverlay } from "@/components/daemon/input-ref-overlay";

describe("InputRefOverlay（FR-03 镜像高亮层）", () => {
  it("tokens 为空返回 null（零视觉回归）", () => {
    const { container } = render(
      <InputRefOverlay value="任意正文" tokens={[]} onRemoveToken={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("token 段渲染背景块与 × 角标，普通文本占位保留在 DOM（撑版式）", () => {
    const { container } = render(
      <InputRefOverlay
        value="前文【截图.png】后文"
        tokens={["【截图.png】"]}
        onRemoveToken={() => {}}
      />,
    );
    expect(screen.getByLabelText("移除引用 截图.png")).toBeInTheDocument();
    expect(container.textContent).toContain("前文【截图.png】后文");
  });

  it("× 角标点击回调携 token 且事件不外溢（preventDefault+stopPropagation）", () => {
    const onRemove = vi.fn();
    const outerClick = vi.fn();
    render(
      <div onClick={outerClick}>
        <InputRefOverlay
          value="【A.png】和【B.png】"
          tokens={["【A.png】", "【B.png】"]}
          onRemoveToken={onRemove}
        />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("移除引用 B.png"));
    expect(onRemove).toHaveBeenCalledWith("【B.png】");
    expect(outerClick).not.toHaveBeenCalled();
  });

  it("重复出现与多 token 拆分：每个出现都有独立角标", () => {
    render(
      <InputRefOverlay
        value="一【A.png】二【A.png】三【B.png】"
        tokens={["【A.png】", "【B.png】"]}
        onRemoveToken={() => {}}
      />,
    );
    expect(screen.getAllByLabelText("移除引用 A.png").length).toBe(2);
    expect(screen.getAllByLabelText("移除引用 B.png").length).toBe(1);
  });
});
