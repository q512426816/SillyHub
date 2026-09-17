/**
 * wheel-scroll-unlock 单测（ql-20260917-004）。
 *
 * jsdom 无真实布局：scrollHeight/clientHeight 默认 0，需在元素上直接赋值
 * 模拟溢出；getComputedStyle 只回内联样式，overflow 用内联 style 设置。
 * 事件从内容元素自然派发（冒泡经 document 捕获监听），不伪造 target。
 */

import { describe, expect, it, afterEach } from "vitest";

import { attachWheelUnlock, findScrollableAncestor, wheelDeltaPixels } from "../wheel-scroll-unlock";

function buildDom() {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.className = "file-preview-modal-root";
  const wrapper = document.createElement("div");
  wrapper.style.overflowY = "auto";
  // jsdom 布局度量缺省 0：手工赋值模拟「可滚 100px 溢出」
  Object.defineProperty(wrapper, "scrollHeight", { value: 800, configurable: true });
  Object.defineProperty(wrapper, "clientHeight", { value: 400, configurable: true });
  const content = document.createElement("p");
  content.textContent = "markdown 行";
  wrapper.appendChild(content);
  root.appendChild(wrapper);
  document.body.appendChild(root);
  return { root, wrapper, content };
}

describe("findScrollableAncestor", () => {
  it("从深层节点向上找到可滚容器", () => {
    const { root, wrapper, content } = buildDom();
    expect(findScrollableAncestor(content, root, "y")).toBe(wrapper);
  });

  it("无可滚祖先 → null", () => {
    const { root, wrapper, content } = buildDom();
    // 去掉 overflow（保持 DOM 祖先链完整——remove 会留下 detached 父子关系）
    wrapper.removeAttribute("style");
    expect(findScrollableAncestor(content, root, "y")).toBeNull();
  });
});

describe("wheelDeltaPixels", () => {
  it("像素模式原样返回", () => {
    expect(wheelDeltaPixels(120, 0, document.body)).toBe(120);
  });

  it("行模式 ×16", () => {
    expect(wheelDeltaPixels(3, 1, document.body)).toBe(48);
  });

  it("页模式 × clientHeight", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
    expect(wheelDeltaPixels(2, 2, el)).toBe(1000);
  });
});

describe("attachWheelUnlock", () => {
  let detach: (() => void) | null = null;

  afterEach(() => {
    detach?.();
    detach = null;
    document.body.removeAttribute("data-scroll-locked");
    document.body.innerHTML = "";
  });

  it("锁激活 + 事件在弹窗根内 → 手动滚动并接管默认行为", () => {
    const { content, wrapper } = buildDom();
    document.body.setAttribute("data-scroll-locked", "1");
    detach = attachWheelUnlock(".file-preview-modal-root");
    const ev = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    content.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(wrapper.scrollTop).toBe(120);
  });

  it("无锁时不介入（默认行为交还浏览器）", () => {
    const { content, wrapper } = buildDom();
    detach = attachWheelUnlock(".file-preview-modal-root");
    const ev = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    content.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(wrapper.scrollTop).toBe(0);
  });

  it("锁激活但事件在弹窗外 → 不动", () => {
    document.body.setAttribute("data-scroll-locked", "1");
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    detach = attachWheelUnlock(".file-preview-modal-root");
    const ev = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("ctrl+滚轮（缩放）不接管", () => {
    const { content } = buildDom();
    document.body.setAttribute("data-scroll-locked", "1");
    detach = attachWheelUnlock(".file-preview-modal-root");
    const ev = new WheelEvent("wheel", { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true });
    content.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
