import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fireEvent, render, screen } from "@testing-library/react";

import { SessionFloatingPillDock } from "@/components/daemon/session-floating-pill-dock";

// jsdom 无 PointerEvent 构造器，fireEvent.pointerDown(type, init) 的
// clientX/button/pointerId 会被丢弃——构造 Event 后手动挂属性再派发
// （同 floating-session-host.test.tsx 先例）。
function pointerEvt(type: string, props: Record<string, unknown>) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, props);
  return ev;
}

const DOCK_KEY = "sillyhub:session-pill-dock";

function dockEl() {
  return document.querySelector('[data-testid="session-pill-dock"]') as HTMLElement;
}

function renderDock(onPillClick = vi.fn()) {
  render(
    <SessionFloatingPillDock>
      <button type="button" onClick={onPillClick}>
        待决策 0
      </button>
      <button type="button" onClick={onPillClick}>
        变更文件 0
      </button>
    </SessionFloatingPillDock>,
  );
  return onPillClick;
}

beforeEach(() => {
  window.localStorage.removeItem(DOCK_KEY);
});

afterEach(() => {
  // 拖拽钳制用例会改写视口宽，恢复 jsdom 默认 1024×768 防跨用例污染。
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
});

describe("SessionFloatingPillDock（2026-10-16-session-pill-dock-drag）", () => {
  it("竖排停靠组：children 渲染成组（flex-col 右对齐），portal 挂 body", () => {
    renderDock();
    const dock = dockEl();
    // portal 到 body：不受面板祖先 overflow/transform 裁剪
    expect(dock.parentElement).toBe(document.body);
    expect(dock.className).toContain("flex-col");
    expect(dock.className).toContain("items-end");
    // children 全 null 时整组零占位（empty:hidden 契约类）
    expect(dock.className).toContain("empty:hidden");
    expect(dock.querySelectorAll("button")).toHaveLength(2);
    // jsdom 视口 1024×768、组尺寸 0 → 默认右下停靠 (1008, 672)
    expect(dock.style.left).toBe("1008px");
    expect(dock.style.top).toBe("672px");
  });

  it("持久化位置恢复；损坏存档静默回落默认右下", () => {
    window.localStorage.setItem(DOCK_KEY, JSON.stringify({ x: 16, y: 40 }));
    renderDock();
    expect(dockEl().style.left).toBe("16px");
    expect(dockEl().style.top).toBe("40px");

    window.localStorage.setItem(DOCK_KEY, "not-json");
    const { unmount } = render(<SessionFloatingPillDock><i /></SessionFloatingPillDock>);
    expect(dockEl()).toBeTruthy();
    expect(screen.getAllByTestId("session-pill-dock").at(-1)!.style.left).toBe("1008px");
    unmount();
  });

  it("按住拖动超过阈值：跟手且钳制窗内，松手吸附较近左缘并持久化", () => {
    renderDock();
    const dock = dockEl();
    fireEvent(dock, pointerEvt("pointerdown", { button: 0, pointerId: 7, clientX: 1000, clientY: 660 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 7, clientX: 400, clientY: 300 }));
    // base(1008,672) + (-600,-360) → (408,312)，窗内不钳
    expect(dock.style.left).toBe("408px");
    expect(dock.style.top).toBe("312px");
    expect(dock.className).toContain("cursor-grabbing");

    fireEvent(window, pointerEvt("pointerup", { pointerId: 7, clientX: 400, clientY: 300 }));
    // 408+0/2 ≤ 512 → 吸附左缘 EDGE_GAP=16；纵向保持
    expect(dock.style.left).toBe("16px");
    expect(dock.style.top).toBe("312px");
    expect(JSON.parse(window.localStorage.getItem(DOCK_KEY)!)).toEqual({ x: 16, y: 312 });
  });

  it("拖到右半屏松手吸附右缘", () => {
    renderDock();
    const dock = dockEl();
    fireEvent(dock, pointerEvt("pointerdown", { button: 0, pointerId: 7, clientX: 1000, clientY: 660 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 7, clientX: 1015, clientY: 300 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 7, clientX: 1015, clientY: 300 }));
    // 钳到 1023 ≥ 512 → 右缘 1024-0-16=1008
    expect(dock.style.left).toBe("1008px");
    expect(JSON.parse(window.localStorage.getItem(DOCK_KEY)!).x).toBe(1008);
  });

  it("拖拽越界钳回窗内：y 不出上下边", () => {
    renderDock();
    const dock = dockEl();
    fireEvent(dock, pointerEvt("pointerdown", { button: 0, pointerId: 7, clientX: 1000, clientY: 660 }));
    // dy=-1000 → y=672-1000<0 钳 0；dx=-600 → 408
    fireEvent(window, pointerEvt("pointermove", { pointerId: 7, clientX: 400, clientY: -340 }));
    expect(dock.style.left).toBe("408px");
    expect(dock.style.top).toBe("0px");
    fireEvent(window, pointerEvt("pointerup", { pointerId: 7, clientX: 400, clientY: -340 }));
    expect(dock.style.top).toBe("0px");
  });

  it("位移小于阈值不算拖拽：click 放行给 pill 按钮", () => {
    const onPillClick = renderDock();
    const btn = dockEl().querySelector("button")!;
    fireEvent(btn, pointerEvt("pointerdown", { button: 0, pointerId: 3, clientX: 500, clientY: 500 }));
    // hypot(2,2)≈2.8 < 阈值 6
    fireEvent(window, pointerEvt("pointermove", { pointerId: 3, clientX: 502, clientY: 502 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 3, clientX: 502, clientY: 502 }));
    fireEvent.click(btn);
    expect(onPillClick).toHaveBeenCalledTimes(1);
  });

  it("拖拽结束后的残余 click 被吞；时间窗外恢复点击", async () => {
    const onPillClick = renderDock();
    const btn = dockEl().querySelector("button")!;
    fireEvent(btn, pointerEvt("pointerdown", { button: 0, pointerId: 9, clientX: 500, clientY: 500 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 9, clientX: 200, clientY: 500 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 9, clientX: 200, clientY: 500 }));
    // 松手 250ms 内的拖拽尾音 click：吞掉（时间窗口径同悬浮球先例）
    fireEvent.click(btn);
    expect(onPillClick).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 280));
    fireEvent.click(btn);
    expect(onPillClick).toHaveBeenCalledTimes(1);
  });

  it("视口缩放：钳回窗内并保持吸附侧", () => {
    renderDock();
    const dock = dockEl();
    expect(dock.style.left).toBe("1008px"); // 右缘停靠
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });
    fireEvent(window, new Event("resize"));
    // 钳到 500 后仍在右半屏 → 右缘 500-0-16=484
    expect(dock.style.left).toBe("484px");
  });
});
