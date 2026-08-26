// ql-20260826-010：SessionInputBar 高度拖拽调节单测。
//
// 覆盖：
//   1. 拖拽上移 60px → textarea 高度 = 起点 + 60 并落 localStorage；
//   2. 挂载回读持久化高度（预置 200 → style.height 200px）；
//   3. 双击手柄恢复默认（高度清除 + localStorage 键删除）；
//   4. 拖拽下压越过下限 → 钳制在 44px（min-h-11 默认高度）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SessionInputBar } from "../session-input-bar";

vi.mock("@/lib/api/session-attachments", () => ({
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
  fetchAttachmentObjectUrl: vi.fn(),
}));

const HEIGHT_KEY = "sillyhub.sessions.inputBarHeight";

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
    fireEvent.mouseDown(handle, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 240 });
    fireEvent.mouseUp(window);

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

    fireEvent.mouseDown(handle, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 500 }); // 下压 200 → 负值钳下限
    fireEvent.mouseUp(window);

    expect(textarea.style.height).toBe("44px");
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("44");
  });
});
