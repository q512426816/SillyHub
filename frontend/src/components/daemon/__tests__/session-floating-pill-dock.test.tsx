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

  it("存档恢复首帧即按吸附侧呈现对齐方向（左档 items-start / 右档 items-end）", () => {
    // 左缘档位恢复：snapPos 重推导 left=true，首帧 items-start 无闪动
    window.localStorage.setItem(DOCK_KEY, JSON.stringify({ x: 16, y: 40 }));
    renderDock();
    expect(dockEl().className).toContain("items-start");
    expect(dockEl().style.left).toBe("16px");

    // 右缘档位恢复：items-end
    window.localStorage.setItem(DOCK_KEY, JSON.stringify({ x: 1008, y: 40 }));
    render(<SessionFloatingPillDock><i /></SessionFloatingPillDock>);
    const dock2 = screen.getAllByTestId("session-pill-dock").at(-1)!;
    expect(dock2.style.left).toBe("1008px");
    expect(dock2.className).toContain("items-end");
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
    // 408+0/2 ≤ 512 → 吸附左缘 EDGE_GAP=16；纵向保持；贴左组内容左对齐
    expect(dock.style.left).toBe("16px");
    expect(dock.style.top).toBe("312px");
    expect(dock.className).toContain("items-start");
    expect(dock.className).not.toContain("items-end");
    // 存档格式不带入 left（对齐由吸附判据从坐标重推导）
    expect(JSON.parse(window.localStorage.getItem(DOCK_KEY)!)).toEqual({ x: 16, y: 312 });
  });

  it("拖到右半屏松手吸附右缘", () => {
    renderDock();
    const dock = dockEl();
    fireEvent(dock, pointerEvt("pointerdown", { button: 0, pointerId: 7, clientX: 1000, clientY: 660 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 7, clientX: 1015, clientY: 300 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 7, clientX: 1015, clientY: 300 }));
    // 钳到 1023 ≥ 512 → 右缘 1024-0-16=1008；贴右保持右对齐
    expect(dock.style.left).toBe("1008px");
    expect(dock.className).toContain("items-end");
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

/* ------------------------------------------------------------------ */
/* 边界容器模式（用户追加：贴边不超出聊天时间线容器范围）                  */
/* ------------------------------------------------------------------ */

/** 边界容器桩：jsdom 原生 rect 全 0，mock 出聊天区矩形才能测边界口径。 */
function mountBoundsEl(rect: { left: number; top: number; width: number; height: number }) {
  const el = document.createElement("div");
  el.setAttribute("data-testid", "turn-timeline-scroll");
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right,
      bottom,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("SessionFloatingPillDock 边界容器模式（2026-10-16-session-pill-dock-drag 用户追加）", () => {
  it("默认位 / 拖拽钳制 / 松手吸附全部以边界容器矩形为准，不贴视口边", () => {
    // 聊天区矩形 100..500 × 50..350（视口 1024×768，明显错开）
    const el = mountBoundsEl({ left: 100, top: 50, width: 400, height: 300 });
    render(
      <SessionFloatingPillDock boundsSelector='[data-testid="turn-timeline-scroll"]'>
        <button type="button">待决策 0</button>
      </SessionFloatingPillDock>,
    );
    const dock = dockEl();
    // 默认右下 = 容器右下角内缩 EDGE_GAP（484/334），不是视口的 1008/672
    expect(dock.style.left).toBe("484px");
    expect(dock.style.top).toBe("334px");

    // 拖到左上：base(484,334)+(-350,-330) → 钳容器内 (134,50)
    fireEvent(dock, pointerEvt("pointerdown", { button: 0, pointerId: 5, clientX: 480, clientY: 330 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 5, clientX: 130, clientY: 0 }));
    expect(dock.style.left).toBe("134px");
    expect(dock.style.top).toBe("50px");
    // 松手吸附容器左缘 100+16=116（不是视口左缘 16）；贴左内容左对齐
    fireEvent(window, pointerEvt("pointerup", { pointerId: 5, clientX: 130, clientY: 0 }));
    expect(dock.style.left).toBe("116px");
    expect(dock.className).toContain("items-start");
    expect(JSON.parse(window.localStorage.getItem(DOCK_KEY)!)).toEqual({ x: 116, y: 50 });
    el.remove();
  });

  it("右缘吸附同样是容器右缘（拖出容器右侧被钳回）", () => {
    const el = mountBoundsEl({ left: 100, top: 50, width: 400, height: 300 });
    render(
      <SessionFloatingPillDock boundsSelector='[data-testid="turn-timeline-scroll"]'>
        <button type="button">待决策 0</button>
      </SessionFloatingPillDock>,
    );
    const dock = dockEl();
    fireEvent(dock, pointerEvt("pointerdown", { button: 0, pointerId: 5, clientX: 480, clientY: 330 }));
    // 拖出容器右缘（dx=+120 → 604）→ 钳到 500，松手吸附 500-16=484
    fireEvent(window, pointerEvt("pointermove", { pointerId: 5, clientX: 600, clientY: 330 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 5, clientX: 600, clientY: 330 }));
    expect(dock.style.left).toBe("484px");
    expect(JSON.parse(window.localStorage.getItem(DOCK_KEY)!).x).toBe(484);
    el.remove();
  });

  it("边界元素不存在时回落视口口径，不报错（元素后挂载可自愈）", () => {
    render(
      <SessionFloatingPillDock boundsSelector='[data-testid="turn-timeline-scroll"]'>
        <button type="button">待决策 0</button>
      </SessionFloatingPillDock>,
    );
    const dock = dockEl();
    // 无边界元素：x 用视口右缘；y 因传了 boundsSelector 按 EDGE_GAP 贴底（元素出现后 settle 自愈）
    expect(dock.style.left).toBe("1008px");
    expect(dock.style.top).toBe("752px");
  });
});
