"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import "@uiw/react-markdown-preview/markdown.css";

/**
 * MarkdownText —— 紧凑型 Markdown 渲染组件。
 *
 * 基于 @uiw/react-markdown-preview，面向气泡 / 历史回看 / 运行日志等小尺寸场景：
 * - dynamic import + ssr:false（react-markdown 依赖浏览器 API，禁 SSR）
 * - 覆盖 .wmde-markdown 默认的大字号 / padding，统一 text-xs leading-relaxed
 * - 代码块紧凑小字体、横向可滚动；链接在新窗口打开
 * - 文字色继承父容器，适配深浅气泡背景
 *
 * 使用示例：`<MarkdownText content={turn.output} className="min-w-0" />`
 */
const MarkdownPreview = dynamic(() => import("@uiw/react-markdown-preview"), {
  ssr: false,
  loading: () => null,
});

type PreviewProps = ComponentProps<typeof MarkdownPreview>;

// 链接强制在新窗口打开，避免点击后离开当前会话
const previewComponents: NonNullable<PreviewProps["components"]> = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

// 紧凑样式：覆盖 markdown.css 默认的大字号 / padding / 段落间距
const COMPACT_CLASS = cn(
  "markdown-text min-w-0 break-words [overflow-wrap:anywhere]",
  "[&_.wmde-markdown]:!m-0 [&_.wmde-markdown]:!bg-transparent [&_.wmde-markdown]:!p-0",
  "[&_.wmde-markdown]:!text-xs [&_.wmde-markdown]:!leading-relaxed [&_.wmde-markdown]:!text-inherit",
  "[&_.wmde-markdown_p]:!my-1.5 [&_.wmde-markdown_p:first-child]:!mt-0 [&_.wmde-markdown_p:last-child]:!mb-0",
  "[&_.wmde-markdown_h1]:!my-2 [&_.wmde-markdown_h1]:!text-sm [&_.wmde-markdown_h1]:!font-semibold",
  "[&_.wmde-markdown_h2]:!my-2 [&_.wmde-markdown_h2]:!text-sm [&_.wmde-markdown_h2]:!font-semibold",
  "[&_.wmde-markdown_h3]:!my-1.5 [&_.wmde-markdown_h3]:!text-xs [&_.wmde-markdown_h3]:!font-semibold",
  "[&_.wmde-markdown_h4]:!my-1.5 [&_.wmde-markdown_h4]:!text-xs [&_.wmde-markdown_h4]:!font-semibold",
  "[&_.wmde-markdown_ul]:!my-1.5 [&_.wmde-markdown_ul]:!pl-4",
  "[&_.wmde-markdown_ol]:!my-1.5 [&_.wmde-markdown_ol]:!pl-4",
  "[&_.wmde-markdown_li]:!my-0",
  "[&_.wmde-markdown_blockquote]:!my-1.5 [&_.wmde-markdown_blockquote]:!border-l-2 [&_.wmde-markdown_blockquote]:!pl-2 [&_.wmde-markdown_blockquote]:!text-muted-foreground [&_.wmde-markdown_blockquote]:!not-italic",
  "[&_.wmde-markdown_pre]:!my-1.5 [&_.wmde-markdown_pre]:!overflow-x-auto [&_.wmde-markdown_pre]:!rounded-md [&_.wmde-markdown_pre]:!bg-muted/60 [&_.wmde-markdown_pre]:!p-2",
  "[&_.wmde-markdown_pre_code]:!bg-transparent [&_.wmde-markdown_pre_code]:!p-0",
  "[&_.wmde-markdown_code]:!font-mono [&_.wmde-markdown_code]:!text-[11px]",
  "[&_a]:!text-primary [&_a]:!underline [&_a]:!underline-offset-2",
);

export interface MarkdownTextProps {
  /** Markdown 文本内容 */
  content: string;
  /** 外层容器 className */
  className?: string;
}

export function MarkdownText({ content, className }: MarkdownTextProps) {
  if (!content) {
    return null;
  }
  return (
    <div className={cn(COMPACT_CLASS, className)}>
      <MarkdownPreview source={content} components={previewComponents} />
    </div>
  );
}
