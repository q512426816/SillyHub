/**
 * wheel-scroll-unlock — antd 弹窗叠 radix Dialog 时的滚轮解锁（ql-20260917-004）。
 *
 * 根因：antd Modal portal 到 body，不在 radix DialogContent 的 React 子树内；
 * radix 的 react-remove-scroll 在 document（冒泡、non-passive）上拦截 wheel/
 * touchmove，凡目标不在其 shards（DialogContent DOM）内的滚动一律
 * preventDefault——叠加在上层的全屏预览弹窗滚轮被整体吞掉（实测 scrollTop
 * 恒 0，body 带 data-scroll-locked）。
 *
 * 修法：document 捕获阶段（先于其冒泡监听）对「目标在本弹窗根内」的事件
 * 手动完成滚动并自己 preventDefault——默认行为不再依赖被吞的 default
 * action；弹窗内其他监听器照常触发（捕获在 document、未 stopPropagation）。
 * 无锁（body 无 data-scroll-locked）时不介入——所有既有入口零回归。
 */

/** body 上的滚动锁标记（react-remove-scroll-bar 设置）。 */
function scrollLocked(): boolean {
  return typeof document !== "undefined" && document.body.hasAttribute("data-scroll-locked");
}

/**
 * 从 start 向上找 root 内第一个可滚容器（overflow auto/scroll 且该轴有溢出）。
 * 纯 DOM 遍历，供单测直接构造 DOM 断言。
 */
export function findScrollableAncestor(
  start: Node,
  root: Element,
  axis: "x" | "y",
): HTMLElement | null {
  let el: Element | null = start instanceof Element ? start : start.parentElement;
  while (el && el !== root) {
    const cs = getComputedStyle(el);
    const overflow = axis === "y" ? cs.overflowY : cs.overflowX;
    if (overflow === "auto" || overflow === "scroll") {
      const hasOverflow =
        axis === "y" ? el.scrollHeight - el.clientHeight > 0 : el.scrollWidth - el.clientWidth > 0;
      if (hasOverflow && el instanceof HTMLElement) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/** wheel delta 归一为像素（deltaMode：0 像素 / 1 行 / 2 页）。 */
export function wheelDeltaPixels(delta: number, mode: number, element: Element): number {
  if (mode === 1) return delta * 16; // 行高近似
  if (mode === 2) {
    return delta * (element.clientHeight || 400);
  }
  return delta;
}

/**
 * 挂载解锁监听（wheel + touchmove）。返回清理函数。
 *
 * @param rootSelector 弹窗根选择器（事件目标须在其内）
 */
export function attachWheelUnlock(rootSelector: string): () => void {
  let lastTouchY: number | null = null;

  const scrollBy = (target: Node, dy: number): void => {
    const root = target instanceof Element ? target.closest(rootSelector) : target.parentElement?.closest(rootSelector);
    if (!root) return;
    const el = findScrollableAncestor(target, root, "y");
    if (!el) return;
    el.scrollTop += wheelDeltaPixels(dy, 0, el);
  };

  const onWheel = (e: Event): void => {
    const ev = e as WheelEvent;
    if (ev.defaultPrevented || ev.ctrlKey || !scrollLocked()) return;
    if (!(ev.target instanceof Node)) return;
    const root = ev.target instanceof Element ? ev.target.closest(rootSelector) : null;
    if (!root) return;
    const dy = wheelDeltaPixels(ev.deltaY, ev.deltaMode, root);
    scrollBy(ev.target, dy);
    ev.preventDefault();
  };

  const onTouchStart = (e: Event): void => {
    const ev = e as TouchEvent;
    lastTouchY = ev.touches.length > 0 ? ev.touches[0]!.clientY : null;
  };

  const onTouchMove = (e: Event): void => {
    const ev = e as TouchEvent;
    if (ev.defaultPrevented || !scrollLocked() || ev.touches.length !== 1) return;
    if (!(ev.target instanceof Node)) return;
    const root = ev.target instanceof Element ? ev.target.closest(rootSelector) : null;
    if (!root) return;
    const y = ev.touches[0]!.clientY;
    if (lastTouchY !== null) {
      scrollBy(ev.target, lastTouchY - y); // 上滑（y 减小）→ 正向滚动
    }
    lastTouchY = y;
    ev.preventDefault();
  };

  document.addEventListener("wheel", onWheel, { capture: true, passive: false });
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  return () => {
    document.removeEventListener("wheel", onWheel, { capture: true });
    document.removeEventListener("touchstart", onTouchStart, { capture: true });
    document.removeEventListener("touchmove", onTouchMove, { capture: true });
  };
}
