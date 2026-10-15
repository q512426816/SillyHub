import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ChangeTabs,
  DETAIL_TAB_ORDER,
  TAB_LABELS,
  visibleTabs,
  type DetailTab,
} from "@/components/changes/detail/change-tabs";

describe("visibleTabs", () => {
  it("在途态：四 tab，顺序恒为 概览→产出→过程→文件与对账", () => {
    expect(visibleTabs(false)).toEqual<DetailTab[]>([
      "overview",
      "assets",
      "process",
      "files",
    ]);
  });

  it("归档态：收窄为三 tab（隐藏「文件与对账」），其余顺序不变", () => {
    expect(visibleTabs(true)).toEqual<DetailTab[]>(["overview", "assets", "process"]);
  });

  it("判定输入只有 archived 一个布尔（thin 不特判：同一布尔结果恒等）", () => {
    expect(visibleTabs(true)).toEqual(visibleTabs(true));
    expect(visibleTabs(false)).toEqual(visibleTabs(false));
    expect(visibleTabs(false)).not.toEqual(visibleTabs(true));
  });

  it("返回新数组（调用方改动不影响常量源）", () => {
    const tabs = visibleTabs(false);
    tabs.pop();
    expect(visibleTabs(false)).toHaveLength(4);
    expect(DETAIL_TAB_ORDER).toHaveLength(4);
  });
});

describe("ChangeTabs", () => {
  it("在途态渲染 4 个 tab、aria-selected 仅当前项为 true", () => {
    render(<ChangeTabs archived={false} value="assets" onChange={() => undefined} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.textContent)).toEqual([
      "概览",
      "产出",
      "过程",
      "文件与对账",
    ]);
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe(TAB_LABELS.assets);
  });

  it("归档态渲染 3 个 tab（无「文件与对账」）", () => {
    render(<ChangeTabs archived value="overview" onChange={() => undefined} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual(["概览", "产出", "过程"]);
    expect(screen.queryByText(TAB_LABELS.files)).not.toBeInTheDocument();
  });

  it("点击任一 tab 触发 onChange 且入参为该 tab 的 DetailTab 值", () => {
    const onChange = vi.fn();
    render(<ChangeTabs archived={false} value="overview" onChange={onChange} />);
    fireEvent.click(screen.getByText(TAB_LABELS.process));
    expect(onChange).toHaveBeenCalledWith("process");
    fireEvent.click(screen.getByText(TAB_LABELS.files));
    expect(onChange).toHaveBeenLastCalledWith("files");
  });

  it("受控纯组件：点击不改变自身 aria-selected（值仍由 value 决定）", () => {
    const onChange = vi.fn();
    render(<ChangeTabs archived={false} value="overview" onChange={onChange} />);
    fireEvent.click(screen.getByText(TAB_LABELS.assets));
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe(TAB_LABELS.overview);
  });
});
