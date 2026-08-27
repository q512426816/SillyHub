/**
 * MobileTopBar 单测（ql-20260827-012：actions 动作槽）。
 *
 * 覆盖：
 *  - 基础形态（仅 title / title+onBack）不渲染 actions 槽（向后兼容）；
 *  - actions 传入时渲染在顶栏末尾（ml-auto 容器内）；
 *  - onBack 回调语义（传回调用回调、不传 router.back）回归锚。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const back = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push: vi.fn(), replace: vi.fn() }),
}));

import { MobileTopBar } from "./mobile-top-bar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MobileTopBar actions 动作槽（ql-20260827-012）", () => {
  it("不传 actions：顶栏不渲染动作槽容器（既有形态零变化）", () => {
    render(<MobileTopBar title="工作区" />);
    expect(screen.getByTestId("mobile-top-bar")).toBeDefined();
    expect(screen.queryByTestId("mobile-top-bar-actions")).toBeNull();
  });

  it("传 actions：渲染在顶栏内且内容可见", () => {
    render(
      <MobileTopBar
        title="工作区"
        actions={<button type="button">主题</button>}
      />,
    );
    expect(screen.getByText("主题")).toBeDefined();
    expect(screen.getByTestId("mobile-top-bar-actions")).toBeDefined();
  });

  it("actions 与返回键共存：返回回调仍走 onBack（回归锚）", () => {
    const onBack = vi.fn();
    render(
      <MobileTopBar
        title="变更详情"
        onBack={onBack}
        actions={<button type="button">主题</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});
