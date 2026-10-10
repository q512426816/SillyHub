// task-02（2026-10-09-attachment-inline-reference）：InputRefOverlay 镜像层单测。
// 覆盖：空 tokens 不渲染（零回归门）、token 段背景块与角标渲染、× 角标点击回调
// 与事件不外溢、多 token/重复出现拆分正确。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InputRefOverlay, hitTestAttRefOverlay } from "@/components/daemon/input-ref-overlay";

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

// 2026-10-10-att-ref-badge-hover：角标悬停显示（FR-01/FR-02）。
describe("InputRefOverlay 角标悬停显示（att-ref-badge-hover）", () => {
  it("角标默认隐藏（opacity-0 + pointer-events-none），visibleBadgeIndex 命中才显示", () => {
    const { rerender } = render(
      <InputRefOverlay
        value="一【A.png】二"
        tokens={["【A.png】"]}
        onRemoveToken={() => {}}
      />,
    );
    const badge = screen.getByLabelText("移除引用 A.png");
    expect(badge.className).toContain("opacity-0");
    expect(badge.className).toContain("pointer-events-none");
    rerender(
      <InputRefOverlay
        value="一【A.png】二"
        tokens={["【A.png】"]}
        onRemoveToken={() => {}}
        visibleBadgeIndex={0}
      />,
    );
    expect(badge.className).toContain("opacity-100");
    expect(badge.className).toContain("pointer-events-auto");
  });

  it("token 占位 span 携带 data-att-ref-occ 出现序号（多出现递增）", () => {
    const { container } = render(
      <InputRefOverlay
        value="一【A.png】二【A.png】三【B.png】"
        tokens={["【A.png】", "【B.png】"]}
        onRemoveToken={() => {}}
      />,
    );
    const occs = Array.from(
      container.querySelectorAll<HTMLElement>("[data-att-ref-occ]"),
    ).map((el) => el.dataset.attRefOcc);
    expect(occs).toEqual(["0", "1", "2"]);
  });

  it("hitTestAttRefOverlay：null 容器/无命中返回 null", () => {
    expect(hitTestAttRefOverlay(null, 10, 10)).toBeNull();
    const { container } = render(
      <InputRefOverlay value="纯文本" tokens={["【X.png】"]} onRemoveToken={() => {}} />,
    );
    // 纯文本无 token 段 → 无 data-att-ref-occ 元素 → null。
    expect(hitTestAttRefOverlay(container.firstElementChild as HTMLElement, 10, 10)).toBeNull();
  });

  // 错位守卫（2026-10-10 用户反馈：多标签累积漂移）——token 占位 span 严禁带
  // margin/padding 类（overlay 与 textarea 逐字符对齐的布局铁律）。
  it("token 占位 span 无 margin/padding 布局类（镜像对齐守卫）", () => {
    const { container } = render(
      <InputRefOverlay
        value="一【A.png】二【A.png】"
        tokens={["【A.png】"]}
        onRemoveToken={() => {}}
      />,
    );
    for (const span of container.querySelectorAll<HTMLElement>("[data-att-ref-occ]")) {
      expect(span.className).not.toMatch(/(^|\s)(m|p)[trblxy]?-/);
    }
  });

  it("既有 × 删除回调行为不变（可见性受控不影响点击）", () => {
    const onRemove = vi.fn();
    render(
      <InputRefOverlay
        value="【A.png】"
        tokens={["【A.png】"]}
        onRemoveToken={onRemove}
        visibleBadgeIndex={0}
      />,
    );
    fireEvent.click(screen.getByLabelText("移除引用 A.png"));
    expect(onRemove).toHaveBeenCalledWith("【A.png】");
  });
});
