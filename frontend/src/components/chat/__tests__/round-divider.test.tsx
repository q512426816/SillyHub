/**
 * RoundDivider 单测（2026-09-09-sessions-visual-refresh task-04 / D-010@v1）。
 * 覆盖：六态着色映射、label/meta 渲染、status 缺省不渲染状态段。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { abbreviateCount, RoundDivider, type RoundDividerStatus } from "../round-divider";

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

describe("RoundDivider 手机端窄视口分支（2026-10-26-mobile-four-page-layout-fix / FR-02）", () => {
  it("abbreviateCount 缩写边界：9999 原样 / 10000 起缩 k / 99999→100.0k", () => {
    expect(abbreviateCount(9999)).toBe("9,999");
    expect(abbreviateCount(10000)).toBe("10.0k");
    expect(abbreviateCount(78489)).toBe("78.5k");
    expect(abbreviateCount(99999)).toBe("100.0k");
    expect(abbreviateCount(2170)).toBe("2,170");
  });

  it("mobile=true：meta 中 ↑/↓ 大数缩写（78,489→78.5k），小数与文字段不动", () => {
    const { getByTestId } = render(
      <RoundDivider label="第 1 轮" status="running" meta="↑78,489 ↓2,170 · 53 tok/s" mobile />,
    );
    const divider = getByTestId("round-divider");
    expect(divider.textContent).toContain("↑78.5k");
    expect(divider.textContent).toContain("↓2,170");
    expect(divider.textContent).toContain("53 tok/s");
  });

  it("mobile=true：胶囊允许收缩折行（去 shrink-0/nowrap）", () => {
    const { getByTestId } = render(<RoundDivider label="第 1 轮" meta="↑78,489" mobile />);
    const pill = getByTestId("round-divider").children[1] as HTMLElement;
    expect(pill.className).toContain("whitespace-normal");
    expect(pill.className).toContain("min-w-0");
    expect(pill.className).not.toContain("whitespace-nowrap");
  });

  it("desktop 锚：缺省（不传 mobile）meta 原样不缩写、胶囊保持 shrink-0 单行", () => {
    const { getByTestId } = render(
      <RoundDivider label="第 1 轮" status="running" meta="↑78,489 ↓2,170 · 53 tok/s" />,
    );
    const divider = getByTestId("round-divider");
    expect(divider.textContent).toContain("↑78,489");
    expect(divider.textContent).not.toContain("78.5k");
    const pill = divider.children[1] as HTMLElement;
    expect(pill.className).toContain("shrink-0");
    expect(pill.className).toContain("whitespace-nowrap");
  });
});
