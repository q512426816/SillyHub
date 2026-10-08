"use client";

import { MarkdownText } from "@/components/ui/markdown-text";
import { cn } from "@/lib/utils";

/**
 * CardMarkdown —— 知识库/扫描文档卡片场景的 markdown 渲染薄壳
 * （2026-09-23-md-card-render / FR-01 / FR-02 / D-002 / D-003）。
 *
 * 包装既有 MarkdownText（compact 档），集中三类卡片场景适配（entry-card-list
 * 4 处正文统一接入，勿在调用点散写样式）：
 * - 宽表格横向滚动（外层 overflow-x-auto），不撑破窄卡片容器；
 * - 表格按内容取宽 + 字号对齐卡片元信息行（11.5px）；
 * - 表头品牌色（brand-50 底 + brand-700 字，brand-* 语义阶随 html
 *   data-theme 双主题换肤，禁硬编码 hex——FRONTEND_PAGE_STYLE §0.5）。
 *
 * 安全：渲染经 MarkdownText 内置 rehype-sanitize 统一过滤——卡片内容源自
 * daemon 上报的扫描文档/知识库（不可信内容红线，契约见 markdown-text.tsx
 * MARKDOWN_SANITIZE_SCHEMA 注释）；本组件不透传 rehypePlugins、不新开渲染路径。
 *
 * 使用示例：`<CardMarkdown content={section.body} className="mt-1.5" />`
 */
export interface CardMarkdownProps {
  /** Markdown 文本内容（卡片正文片段） */
  content: string;
  /** 外层容器 className（cn 合并透传） */
  className?: string;
}

const CARD_MD_CLASS = cn(
  "min-w-0 overflow-x-auto",
  "[&_.wmde-markdown_table]:!w-max [&_.wmde-markdown_table]:!text-[11.5px]",
  "[&_.wmde-markdown_th]:!bg-brand-50 [&_.wmde-markdown_th]:!text-brand-700",
);

export function CardMarkdown({ content, className }: CardMarkdownProps) {
  if (!content) {
    return null;
  }
  return (
    <div className={cn(CARD_MD_CLASS, className)}>
      <MarkdownText content={content} size="compact" />
    </div>
  );
}
