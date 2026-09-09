/**
 * RoundDivider 单测（2026-09-09-sessions-visual-refresh task-04 / D-010@v1）。
 * 覆盖：六态着色映射、label/meta 渲染、status 缺省不渲染状态段。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoundDivider, type RoundDividerStatus } from "../round-divider";

describe("RoundDivider", () => {
  it.each<[RoundDividerStatus, string, string]>([
    ["completed", "已完成", "text-success"],
    ["failed", "失败", "text-error"],
    ["killed", "已中止", "text-error"],
    ["running", "运行中", "text-info"],
    ["pending", "排队中", "text-muted-foreground"],
    ["interrupting", "打断中", "text-muted-foreground"],
  ])("status=%s → 文案「%s」+ 着色 %s", (status, text, cls) => {
    render(<RoundDivider label="第 1 轮" status={status} />);
    const el = screen.getByTestId("round-divider");
    expect(el.textContent).toContain("第 1 轮");
    expect(el.textContent).toContain(text);
    const statusSpan = el.querySelector(`.${cls.replace(/([/-])/g, "\\$1")}`);
    expect(statusSpan).not.toBeNull();
  });

  it("meta 渲染为等宽数字段", () => {
    render(
      <RoundDivider label="第 2 轮" status="completed" meta="↑2,389 ↓199,200" />,
    );
    const el = screen.getByTestId("round-divider");
    expect(el.textContent).toContain("↑2,389 ↓199,200");
    expect(el.querySelector(".tabular-nums")).not.toBeNull();
  });

  it("status 缺省 → 不渲染状态文案，仅 label", () => {
    render(<RoundDivider label="第 3 轮" />);
    const el = screen.getByTestId("round-divider");
    expect(el.textContent).toContain("第 3 轮");
    expect(el.textContent).not.toContain("已完成");
    expect(el.textContent).not.toContain("运行中");
  });

  it("两侧细线（渐变分隔）存在", () => {
    render(<RoundDivider label="第 1 轮" />);
    const el = screen.getByTestId("round-divider");
    expect(el.querySelectorAll(".h-px.flex-1").length).toBe(2);
  });
});
