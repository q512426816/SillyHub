// 2026-10-22-session-trajectory-third-view（D-001）：会话视图三态共享控件。
//
// 锁定：弹窗版 / 整页版 / 移动 variant 复用同一个「对话 / 进度 / 轨迹」切换——
// 轨迹与另外两态同层并列（不再有「进度」内的第二层开关）。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SessionViewTabs } from "../session-view-tabs";

describe("会话视图三态切换（D-001）", () => {
  it("三态并列：对话 / 进度 / 轨迹，点击回调当前值", () => {
    const onChange = vi.fn();
    render(<SessionViewTabs value="conversation" onChange={onChange} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["对话", "进度", "轨迹"]);

    fireEvent.click(screen.getByRole("tab", { name: "轨迹" }));
    expect(onChange).toHaveBeenCalledWith("trajectory");
  });

  it("默认选中对话：value=conversation 时仅「对话」aria-selected", () => {
    render(<SessionViewTabs value="conversation" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "进度" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "轨迹" })).toHaveAttribute("aria-selected", "false");
  });

  it("受控回显：value=trajectory 时「轨迹」选中", () => {
    render(<SessionViewTabs value="trajectory" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "轨迹" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "进度" })).toHaveAttribute("aria-selected", "false");
  });
});
