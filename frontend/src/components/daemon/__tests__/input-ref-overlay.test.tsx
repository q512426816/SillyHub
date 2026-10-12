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

// 2026-10-10-workspace-ref-intake task-04：类型角标与 tooltip 元数据（FR-03/D-001）。
describe("InputRefOverlay 类型角标（tokenMetas）", () => {
  const METAS = {
    "【截图.png】": { kind: "att" as const, title: "附件：截图.png" },
    "【design.md】": { kind: "file" as const, title: "文件：docs/design.md（工作区 ws-1）" },
    "【docs】": { kind: "dir" as const, title: "目录：docs（工作区 ws-1）" },
    "【a.py:10-16】": { kind: "code" as const, title: "代码：src/a.py 第 10-16 行（工作区 ws-1）" },
  };

  it("四类 kind 角标按映射渲染且 title 元数据正确", () => {
    const { container } = render(
      <InputRefOverlay
        value="一【截图.png】二【design.md】三【docs】四【a.py:10-16】"
        tokens={Object.keys(METAS)}
        onRemoveToken={() => {}}
        tokenMetas={METAS}
      />,
    );
    const badges = container.querySelectorAll("[data-ws-ref-kind-badge]");
    expect(Array.from(badges).map((el) => el.getAttribute("data-ws-ref-kind-badge"))).toEqual([
      "att", "file", "dir", "code",
    ]);
    expect(badges[0]).toHaveAttribute("title", "附件：截图.png");
    expect(badges[1]).toHaveAttribute("title", "文件：docs/design.md（工作区 ws-1）");
    expect(badges[3]).toHaveAttribute("title", "代码：src/a.py 第 10-16 行（工作区 ws-1）");
    // 图标按 kind 映射渲染（lucide svg class）
    expect(badges[0]!.querySelector("svg")!.getAttribute("class")).toContain("lucide-paperclip");
    expect(badges[1]!.querySelector("svg")!.getAttribute("class")).toContain("lucide-file-text");
    expect(badges[2]!.querySelector("svg")!.getAttribute("class")).toContain("lucide-folder");
    expect(badges[3]!.querySelector("svg")!.getAttribute("class")).toContain("lucide-braces");
  });

  it("角标默认隐藏，visibleBadgeIndex 命中处淡入（沿用既有悬停机制）", () => {
    const { rerender } = render(
      <InputRefOverlay
        value="【design.md】和【a.py:10-16】"
        tokens={["【design.md】", "【a.py:10-16】"]}
        onRemoveToken={() => {}}
        tokenMetas={METAS}
      />,
    );
    const badges = document.querySelectorAll("[data-ws-ref-kind-badge]");
    expect(badges[0]).toHaveClass("opacity-0", "pointer-events-none");
    expect(badges[1]).toHaveClass("opacity-0", "pointer-events-none");
    rerender(
      <InputRefOverlay
        value="【design.md】和【a.py:10-16】"
        tokens={["【design.md】", "【a.py:10-16】"]}
        onRemoveToken={() => {}}
        tokenMetas={METAS}
        visibleBadgeIndex={1}
      />,
    );
    expect(badges[0]).toHaveClass("opacity-0");
    expect(badges[1]).toHaveClass("opacity-100", "pointer-events-auto");
  });

  it("未传 tokenMetas / token 未命中：零角标渲染，与现状逐字一致", () => {
    const { container } = render(
      <InputRefOverlay value="【A.png】和【B.png】" tokens={["【A.png】", "【B.png】"]} onRemoveToken={() => {}} />,
    );
    expect(container.querySelectorAll("[data-ws-ref-kind-badge]").length).toBe(0);
    // 部分命中：仅命中 token 出角标
    const t2 = render(
      <InputRefOverlay
        value="【A.png】和【B.png】"
        tokens={["【A.png】", "【B.png】"]}
        onRemoveToken={() => {}}
        tokenMetas={{ "【B.png】": { kind: "att", title: "附件：B.png" } }}
      />,
    );
    const badges2 = t2.container.querySelectorAll("[data-ws-ref-kind-badge]");
    expect(badges2.length).toBe(1);
    expect(badges2[0]).toHaveAttribute("data-ws-ref-kind-badge", "att");
  });

  it("版式守卫（R-01）：加角标后占位文本保留、token span 无 margin/padding/border/opacity/transform、× 角标 z-20 不受影响", () => {
    const { container } = render(
      <InputRefOverlay
        value="前文【design.md】后文"
        tokens={["【design.md】"]}
        onRemoveToken={() => {}}
        tokenMetas={{ "【design.md】": { kind: "file", title: "文件：design.md" } }}
        visibleBadgeIndex={0}
      />,
    );
    const tokenSpan = container.querySelector<HTMLElement>("[data-att-ref-occ]")!;
    expect(tokenSpan).not.toBeNull();
    // 背景块零布局类（铁律：严禁 margin/padding/border）
    expect(tokenSpan.className).not.toMatch(/(^|s)(m|p|border)([-s]|$)/);
    // token span 不得带 opacity/transform（stacking context 触发器）
    expect(tokenSpan.className).not.toContain("opacity");
    expect(tokenSpan.className).not.toContain("translate");
    expect(tokenSpan.style.opacity).toBe("");
    expect(tokenSpan.style.transform).toBe("");
    // 占位文本仍在 DOM 撑宽（角标不改变标签文本宽度）
    expect(tokenSpan.querySelector("span.text-transparent")?.textContent).toBe("【design.md】");
    // 角标 absolute 不进文本流；× 角标 z-20 层级保留
    const kindBadge = tokenSpan.querySelector("[data-ws-ref-kind-badge]")!;
    expect(kindBadge.className).toContain("absolute");
    const xBadge = screen.getByLabelText("移除引用 design.md");
    expect(xBadge.className).toContain("z-20");
    expect(xBadge.className).toContain("opacity-100");
  });
});
