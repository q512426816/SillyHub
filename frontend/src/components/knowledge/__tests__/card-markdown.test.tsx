// task-01（2026-09-23-md-card-render / FR-01 / FR-02 / D-002 / D-003）：CardMarkdown
// 卡片场景渲染薄壳单测（行为规格，design §总体方案 Phase 1）。
//
// 覆盖：
//   1. 委托——content 原文转发给 MarkdownText 且固定 size=compact（继承统一
//      rehype-sanitize，不透传 rehypePlugins、不新开渲染路径——安全红线）；
//   2. 降级——空 content 返回 null（与 EntryCardList 旧 `{body ? ... : null}` 等价）；
//   3. 卡片适配——外层容器横向滚动（overflow-x-auto，宽表格不撑破窄卡片）、
//      表格字号对齐 11.5px、表头品牌色（brand-50 底 + brand-700 字，双主题换肤）；
//   4. className 透传合并（cn）。
//
// 测试纪律：MarkdownText stub 化——其内部 next/dynamic（ssr:false）在 jsdom
// 同步渲染 null（.sillyspec/knowledge/testing-gotchas.md 收录，先例
// daemon/__tests__/team-task-block.test.tsx:42-50 同款坑）；md 元素级渲染行为由
// ui/markdown-text.test.tsx 既有测试保障，本文件只测 CardMarkdown 的包装职责，
// 不重复测渲染引擎（行为 vs 实现：包装重构后本文件不应失败）。

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CardMarkdown } from "../card-markdown";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({
    content,
    size,
  }: {
    content: string;
    size?: string;
  }) => (
    <div data-testid="mt-stub" data-size={size}>
      {content}
    </div>
  ),
}));

describe("CardMarkdown 卡片场景渲染薄壳（task-01 / FR-01 / D-003）", () => {
  it("content 原文委托 MarkdownText 渲染，固定 compact 档", () => {
    const md = "**加粗** 与 `code` 混排正文";
    const { container } = render(<CardMarkdown content={md} />);
    const stub = screen.getByTestId("mt-stub");
    expect(stub).toBeInTheDocument();
    expect(stub).toHaveTextContent(md);
    expect(stub).toHaveAttribute("data-size", "compact");
    // 委托而非复制：组件本身不解析 md（无 table/th 节点，渲染归 MarkdownText）
    expect(container.querySelector("table")).toBeNull();
  });

  it("空 content 返回 null（与 EntryCardList 旧空值分支等价）", () => {
    const { container } = render(<CardMarkdown content="" />);
    expect(container.firstChild).toBeNull();
  });

  it("容器携带卡片适配类：横向滚动 + 表格字号 11.5px + 表头品牌色", () => {
    render(<CardMarkdown content="正文" />);
    const wrap = screen.getByTestId("mt-stub").parentElement;
    expect(wrap).not.toBeNull();
    expect(wrap?.className).toContain("overflow-x-auto");
    expect(wrap?.className).toContain("[&_.wmde-markdown_table]:!text-[11.5px]");
    expect(wrap?.className).toContain("[&_.wmde-markdown_th]:!bg-brand-50");
    expect(wrap?.className).toContain("[&_.wmde-markdown_th]:!text-brand-700");
  });

  it("className 透传经 cn 合并进容器", () => {
    render(<CardMarkdown content="正文" className="mt-1.5 text-muted-foreground" />);
    const wrap = screen.getByTestId("mt-stub").parentElement;
    expect(wrap?.className).toContain("mt-1.5");
    expect(wrap?.className).toContain("text-muted-foreground");
    expect(wrap?.className).toContain("overflow-x-auto"); // 合并不覆盖内置适配
  });
});
