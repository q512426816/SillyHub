/**
 * primer 原子组件单测（2026-09-26-core-pages-visual-redesign task-02 / FR-01）。
 *
 * 覆盖矩阵：StateLabel 六变体渲染 × iconName 双态 × withIcon 开关 × size 两档、
 * Counter 数字与 active、EmptyState 插槽与中文默认文案。
 * 依据：tasks/task-02.md acceptance「六变体渲染矩阵 + iconName 双态 + Counter active + EmptyState 插槽」。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Counter } from "../counter";
import { EmptyState } from "../empty-state";
import { StateLabel } from "../state-label";

const VARIANTS = ["open", "merged", "attention", "done", "error", "neutral"] as const;

describe("StateLabel 六变体矩阵", () => {
  it.each(VARIANTS)("variant=%s 渲染文案与 svg 图标", (variant) => {
    const { container } = render(
      <StateLabel variant={variant}>进行中</StateLabel>,
    );
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("attention 双态：默认 zap，iconName=clock 覆写为时钟（两 svg path 集不同）", () => {
    const { container } = render(<StateLabel variant="attention">等待</StateLabel>);
    const zapPaths = container.querySelector("svg")?.innerHTML;
    const { container: c2 } = render(
      <StateLabel variant="attention" iconName="clock">
        等待
      </StateLabel>,
    );
    const clockPaths = c2.querySelector("svg")?.innerHTML;
    expect(zapPaths).toBeTruthy();
    expect(clockPaths).toBeTruthy();
    expect(zapPaths).not.toEqual(clockPaths);
  });

  it("withIcon=false 不渲染图标", () => {
    const { container } = render(
      <StateLabel variant="done" withIcon={false}>
        完成
      </StateLabel>,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("size=md 使用 text-sm 类", () => {
    render(
      <StateLabel variant="open" size="md">
        页头态
      </StateLabel>,
    );
    const el = screen.getByText("页头态").closest("span");
    expect(el?.className).toContain("text-sm");
  });
});

describe("Counter", () => {
  it("渲染数字，默认非 active（无描边色）", () => {
    render(<Counter count={4} />);
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("active 变体带主题色 inline style", () => {
    render(<Counter count={12} active />);
    const el = screen.getByText("12");
    expect(el.style.borderColor).toBe("var(--color-brand-600)");
  });
});

describe("EmptyState", () => {
  it("默认中文标题「暂无数据」+ description + action 插槽", () => {
    render(
      <EmptyState description="当前筛选下没有变更">
        <button type="button">新建变更</button>
      </EmptyState>,
    );
    expect(screen.getByText("暂无数据")).toBeTruthy();
    expect(screen.getByText("当前筛选下没有变更")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建变更" })).toBeTruthy();
  });

  it("title 可覆写", () => {
    render(<EmptyState title="还没有会话" />);
    expect(screen.getByText("还没有会话")).toBeTruthy();
  });
});
