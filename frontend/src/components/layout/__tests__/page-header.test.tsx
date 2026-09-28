/**
 * PageHeader 单测（2026-09-28-change-detail-header-overflow）。
 *
 * 依据：
 *   - components/layout/page-header.tsx（task-01 实现）
 *   - 生产实测根因：header flex 行左侧内容列缺 min-w-0，flex 项默认
 *     min-width:auto，其内 nowrap 长文（详情页描述行）把该列撑到 1861px
 *     溢出 header（1228px）并产生页面级横向滚动（scrollWidth 2219>1600）
 *
 * 覆盖（jsdom 无布局引擎，几何行为由 Playwright 生产复测承担，见变更目录
 * visual-evidence.md；此处锁定布局链前置条件——类名与结构不回退）：
 *   1. 基本渲染：title 进 h1、subtitle 进 p、actions 在右侧槽
 *   2. 左侧内容列带 min-w-0（本变更核心断言，防回退）
 *   3. 详情页长描述场景：truncate span 位于 min-w-0 列内（收缩链完整）
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PageHeader } from "@/components/layout/page-header";

afterEach(() => {
  cleanup();
});

describe("PageHeader 渲染（2026-09-28-change-detail-header-overflow）", () => {
  it("基本结构：title 进 h1 / subtitle 进 p / actions 右侧槽", () => {
    render(
      <PageHeader
        title="变更标题"
        subtitle={<span>Key: 2026-09-28-demo</span>}
        actions={<button type="button">删除</button>}
      />,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "变更标题" });
    expect(h1).toBeInTheDocument();
    expect(screen.getByText("Key: 2026-09-28-demo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("左侧内容列带 min-w-0——flex 项 min-width:auto 陷阱的组件级修复锚", () => {
    render(<PageHeader title="t" subtitle="s" />);
    // 结构：header > div.min-w-0 > (h1 + p)；左列是 h1 的父级 div
    const h1 = screen.getByRole("heading", { level: 1 });
    const leftCol = h1.parentElement;
    expect(leftCol?.tagName).toBe("DIV");
    expect(leftCol?.className).toContain("min-w-0");
    // 右侧 actions 槽与左列同层（header flex 行直接子级）
    expect(leftCol?.parentElement?.tagName).toBe("HEADER");
  });

  it("详情页同款长描述场景：truncate span 渲染在 min-w-0 列内（收缩链前置条件）", () => {
    const longDesc = "很长的描述".repeat(60);
    render(
      <PageHeader
        title={<span className="min-w-0 truncate">标题</span>}
        subtitle={
          <span className="flex flex-wrap gap-x-5 gap-y-0.5">
            <span>Key: demo</span>
            <span title={longDesc} className="w-full min-w-0 truncate text-xs">
              {longDesc}
            </span>
          </span>
        }
      />,
    );
    const desc = screen.getByTitle(longDesc);
    // 链路：desc span → … → 左列 div.min-w-0 → header（截断生效的宽度约束链）
    const leftCol = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(desc.closest("header")).toBe(leftCol?.parentElement);
    expect(leftCol?.className).toContain("min-w-0");
    expect(desc.className).toContain("truncate");
  });
});
