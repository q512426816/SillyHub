// ql-20260826-010：SessionInputBar 高度拖拽调节单测。
// 2026-09-13-session-group-ux-fixes（D-002@v2）：事件迁 Pointer Events，
// 与生产代码同路径覆盖鼠标/触摸统一后的手柄拖拽。
//
// 覆盖：
//   1. 拖拽上移 60px → textarea 高度 = 起点 + 60 并落 localStorage；
//   2. 挂载回读持久化高度（预置 200 → style.height 200px）；
//   3. 双击手柄恢复默认（高度清除 + localStorage 键删除）；
//   4. 拖拽下压越过下限 → 钳制在 44px（min-h-11 默认高度）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";

import { SessionInputBar } from "../session-input-bar";

vi.mock("@/lib/api/session-attachments", () => ({
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
  fetchAttachmentObjectUrl: vi.fn(),
}));

const HEIGHT_KEY = "sillyhub.sessions.inputBarHeight";

/** jsdom 无 PointerEvent 实现，fireEvent.pointer* 走 Event 兜底构造带不上
 *  坐标（React handler 里 clientY 为 undefined）——createEvent 后 defineProperty
 *  手工补属性再派发（先例：explorer-page.test.tsx firePointer、
 *  floating-session-host.test.tsx pointerEvt）；pointerId 补 0 占位。 */
function firePointer(
  el: Element | Window,
  name: "pointerDown" | "pointerMove" | "pointerUp",
  props: { clientY?: number } = {},
) {
  const init = { pointerId: 0, ...props };
  const ev = createEvent[name](el as Element, init);
  for (const [k, v] of Object.entries(init)) {
    Object.defineProperty(ev, k, { value: v });
  }
  fireEvent(el, ev);
}

function renderBar() {
  return render(
    <SessionInputBar
      value=""
      onChange={() => {}}
      onSend={() => {}}
      disabled={false}
      placeholder="测试输入"
      creating={false}
    />,
  );
}

function getHandle() {
  return screen.getByRole("separator", {
    name: /拖动调节输入框高度/,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("SessionInputBar 高度拖拽（ql-20260826-010）", () => {
  it("拖拽上移 60px → 高度生效 + localStorage 落盘", () => {
    renderBar();
    const handle = getHandle();
    const textarea = screen.getByPlaceholderText(
      "测试输入",
    ) as HTMLTextAreaElement;

    // jsdom 无布局，起点按默认下限 44；上移 60 → 104。
    firePointer(handle, "pointerDown", { clientY: 300 });
    firePointer(window, "pointerMove", { clientY: 240 });
    firePointer(window, "pointerUp");

    expect(textarea.style.height).toBe("104px");
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("104");
  });

  it("挂载回读持久化高度（预置 200）", () => {
    window.localStorage.setItem(HEIGHT_KEY, "200");
    renderBar();
    const textarea = screen.getByPlaceholderText(
      "测试输入",
    ) as HTMLTextAreaElement;
    expect(textarea.style.height).toBe("200px");
  });

  it("双击手柄恢复默认：高度清除 + 键删除", () => {
    window.localStorage.setItem(HEIGHT_KEY, "200");
    renderBar();
    const textarea = screen.getByPlaceholderText(
      "测试输入",
    ) as HTMLTextAreaElement;
    expect(textarea.style.height).toBe("200px");

    fireEvent.doubleClick(getHandle());
    expect(textarea.style.height).toBe("");
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBeNull();
  });

  it("拖拽下压越过下限 → 钳制 44px", () => {
    renderBar();
    const handle = getHandle();
    const textarea = screen.getByPlaceholderText(
      "测试输入",
    ) as HTMLTextAreaElement;

    firePointer(handle, "pointerDown", { clientY: 300 });
    firePointer(window, "pointerMove", { clientY: 500 }); // 下压 200 → 负值钳下限
    firePointer(window, "pointerUp");

    expect(textarea.style.height).toBe("44px");
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("44");
  });
});
