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

// 2026-10-12-ws-ref-emoji-inline：类型图标内嵌 token 文本（构造层落字），overlay
// 零角标渲染；悬停元数据走 hoverTip 浮层（FR-03 形态更新）。
describe("InputRefOverlay emoji 内嵌形态与 hoverTip", () => {
  const METAS = {
    "【📎 截图.png】": { kind: "att" as const, title: "附件：截图.png" },
    "【📄 design.md】": { kind: "file" as const, title: "文件：docs/design.md（工作区 ws-1）" },
    "【📁 docs】": { kind: "dir" as const, title: "目录：docs（工作区 ws-1）" },
    "【🧾 a.py:10-16】": { kind: "code" as const, title: "代码：src/a.py 第 10-16 行（工作区 ws-1）" },
  };

  it("token（含内嵌 emoji）整段高亮为背景块；无左上类型角标（已随形态退役）", () => {
    const { container } = render(
      <InputRefOverlay
        value="一【📎 截图.png】二【📄 design.md】三【📁 docs】四【🧾 a.py:10-16】"
        tokens={Object.keys(METAS)}
        onRemoveToken={() => {}}
        tokenMetas={METAS}
      />,
    );
    // emoji 是 token 文本的一部分：占位文本含 emoji（textarea 同文本同宽度）。
    const spans = container.querySelectorAll("[data-att-ref-occ]");
    expect(spans.length).toBe(4);
    expect(spans[0]!.querySelector("span.text-transparent")?.textContent).toBe("【📎 截图.png】");
    expect(spans[3]!.querySelector("span.text-transparent")?.textContent).toBe("【🧾 a.py:10-16】");
    // 类型角标已移除（图标内嵌文本，不再有独立角标元素）。
    expect(container.querySelectorAll("[data-ws-ref-kind-badge]").length).toBe(0);
  });

  it("hoverTip 传入时渲染 fixed 元数据气泡；null 时零渲染", () => {
    const { container, rerender } = render(
      <InputRefOverlay
        value="看【📄 design.md】这段"
        tokens={["【📄 design.md】"]}
        onRemoveToken={() => {}}
        tokenMetas={METAS}
        hoverTip={{ text: "文件：docs/design.md（工作区 ws-1）", x: 100, y: 200 }}
      />,
    );
    const tip = container.querySelector("[data-ws-ref-hover-tip]");
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toBe("文件：docs/design.md（工作区 ws-1）");
    expect(tip!.className).toContain("fixed");
    rerender(
      <InputRefOverlay
        value="看【📄 design.md】这段"
        tokens={["【📄 design.md】"]}
        onRemoveToken={() => {}}
        tokenMetas={METAS}
        hoverTip={null}
      />,
    );
    expect(container.querySelector("[data-ws-ref-hover-tip]")).toBeNull();
  });

  it("hoverTip 底部空间不足翻到鼠标上方（输入框贴页面底缘场景，2026-10-12 修复）", () => {
    const { container } = render(
      <InputRefOverlay
        value="【📄 design.md】"
        tokens={["【📄 design.md】"]}
        onRemoveToken={() => {}}
        /* jsdom innerHeight 默认 768：y=720 时 720+16+48=784 超出 → 翻转上方。 */
        hoverTip={{ text: "文件：docs/design.md（工作区 ws-1）", x: 100, y: 720 }}
      />,
    );
    const tip = container.querySelector<HTMLElement>("[data-ws-ref-hover-tip]")!;
    expect(tip).not.toBeNull();
    expect(tip.style.top).toBe("662px"); // 720 - 48(TIP_EST_HEIGHT) - 10
    // 常规位置（下方 16px）不受影响
    const { container: c2 } = render(
      <InputRefOverlay
        value="【📄 design.md】"
        tokens={["【📄 design.md】"]}
        onRemoveToken={() => {}}
        hoverTip={{ text: "x", x: 100, y: 200 }}
      />,
    );
    const tip2 = c2.querySelector<HTMLElement>("[data-ws-ref-hover-tip]")!;
    expect(tip2.style.top).toBe("216px");
  });

  it("× 角标 aria-label 剥离内嵌 emoji 前缀（提示语只留名称）", () => {
    render(
      <InputRefOverlay
        value="【📄 design.md】"
        tokens={["【📄 design.md】"]}
        onRemoveToken={() => {}}
      />,
    );
    const btn = screen.getByLabelText("移除引用 design.md");
    expect(btn.className).toContain("z-20");
  });

  it("版式守卫（R-01）：token span 无 margin/padding/border/opacity/transform、× 角标 z-20 不受影响", () => {
    const { container } = render(
      <InputRefOverlay
        value="前文【📄 design.md】后文"
        tokens={["【📄 design.md】"]}
        onRemoveToken={() => {}}
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
    // 占位文本仍在 DOM 撑宽
    expect(tokenSpan.querySelector("span.text-transparent")?.textContent).toBe("【📄 design.md】");
    // × 角标 z-20 层级保留
    const xBadge = screen.getByLabelText("移除引用 design.md");
    expect(xBadge.className).toContain("z-20");
    expect(xBadge.className).toContain("opacity-100");
  });
});
