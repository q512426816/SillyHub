"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { memo } from "react";

import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

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

/**
 * Markdown 渲染统一 sanitize schema（task-13 / FR-13 / D-006@v1）。
 *
 * @uiw/react-markdown-preview 默认启用 rehype-raw（markdown 内嵌 HTML 直出），
 * agent 输出 / 扫描文档 / 变更文件预览均渲染不可信内容，构成存储型 XSS。
 * 此 schema 基于 hast-util-sanitize 的 GitHub 风格 defaultSchema（已含表格
 * 全家族、code.language-*、任务列表 input[type=checkbox]、href/src 协议白名单、
 * script 剥离），仅按 @uiw 渲染管线在 sanitize 之前已注入的节点形态做最小放开：
 *
 * - a: target=_blank / rel=noreferrer noopener（MarkdownText 链接强制新窗），
 *   anchor 类（标题锚点链接，rehype-slug/autolink-headings 产物）
 * - div: copied 类 + data-code（@uiw rehype-rewrite 注入的代码块复制按钮；
 *   其写入的是裸属性名 class/data-code，而 GFM 产驼峰 className，两者都放）
 * - svg / path: 类名白名单（octicon/octicon-copy/octicon-check/octicon-link）、
 *   viewBox/fill/width/height/version/d 等（复制按钮与标题锚点的内联图标，
 *   rehype-rewrite 注入，非用户可控；svg 用户 HTML 本就不在 tagNames 放开列）
 * - code: data-meta（fenced code 信息串，rehype-prism-plus 显示行号/复制用）
 *
 * 属性名混用说明：schema 键按 hast properties 逐字匹配——@uiw 注入裸名
 * （class、data-code、aria-hidden），mdast-util-to-hast 产驼峰（className、
 * dataCode），故同一语义两种键各配一条。sanitize 位于 @uiw 插件数组末位
 * 之前（rehype-raw/rewrite 之后、rehype-prism 之前），所有转换后再过滤。
 */
export const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "svg", "path"],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["target", "_blank"],
      // rel 值经 space-separated 解析成数组，逐项匹配（noreferrer / noopener）
      ["rel", "noreferrer", "noopener"],
      ["className", "anchor"],
      ["class", "anchor"],
      "ariaHidden",
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "copied"],
      ["class", "copied"],
      ["dataCode", /^[^\n]*$/],
      ["data-code", /^[^\n]*$/],
    ],
    code: [...(defaultSchema.attributes?.code ?? []), "dataMeta", ["data-meta", /^[^\n]*$/]],
    // svg/path 仅放行 @uiw 内联图标实际用到的属性；d/fill-rule 图标路径数据
    svg: [
      "className",
      "class",
      "viewBox",
      "version",
      "width",
      "height",
      "fill",
      "ariaHidden",
      "aria-hidden",
    ],
    path: ["fillRule", "fill-rule", "d", "fill"],
  },
} as typeof defaultSchema;

/** 三处 @uiw 引用共用的 sanitize 插件（单例，避免每次渲染重建数组） */
export const markdownRehypePlugins = [[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]] as unknown as ComponentProps<
  typeof MarkdownPreview
>["rehypePlugins"];

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

// 阅读尺寸（2026-08-05-skill-content-viewer task-04）：供抽屉长文阅读，比紧凑型
// 更大字号 / 行距 / 标题尺寸。compact 保持原样（现有 6+ 处复用不动，向后兼容）。
const READING_CLASS = cn(
  "markdown-text min-w-0 break-words [overflow-wrap:anywhere]",
  "[&_.wmde-markdown]:!bg-transparent [&_.wmde-markdown]:!p-2 [&_.wmde-markdown]:!text-foreground",
  "[&_.wmde-markdown]:!text-sm [&_.wmde-markdown]:!leading-7",
  "[&_.wmde-markdown_p]:!my-3 [&_.wmde-markdown_p:first-child]:!mt-0 [&_.wmde-markdown_p:last-child]:!mb-0",
  "[&_.wmde-markdown_h1]:!my-4 [&_.wmde-markdown_h1]:!text-2xl [&_.wmde-markdown_h1]:!font-semibold",
  "[&_.wmde-markdown_h2]:!my-3 [&_.wmde-markdown_h2]:!text-xl [&_.wmde-markdown_h2]:!font-semibold [&_.wmde-markdown_h2]:!pb-1 [&_.wmde-markdown_h2]:!border-b",
  "[&_.wmde-markdown_h3]:!my-2.5 [&_.wmde-markdown_h3]:!text-base [&_.wmde-markdown_h3]:!font-semibold",
  "[&_.wmde-markdown_h4]:!my-2 [&_.wmde-markdown_h4]:!text-sm [&_.wmde-markdown_h4]:!font-semibold",
  "[&_.wmde-markdown_ul]:!my-2 [&_.wmde-markdown_ul]:!pl-5",
  "[&_.wmde-markdown_ol]:!my-2 [&_.wmde-markdown_ol]:!pl-5",
  "[&_.wmde-markdown_li]:!my-0.5",
  "[&_.wmde-markdown_blockquote]:!my-3 [&_.wmde-markdown_blockquote]:!border-l-2 [&_.wmde-markdown_blockquote]:!pl-3 [&_.wmde-markdown_blockquote]:!text-muted-foreground [&_.wmde-markdown_blockquote]:!not-italic",
  "[&_.wmde-markdown_pre]:!my-3 [&_.wmde-markdown_pre]:!overflow-x-auto [&_.wmde-markdown_pre]:!rounded-md [&_.wmde-markdown_pre]:!bg-muted/60 [&_.wmde-markdown_pre]:!p-3",
  "[&_.wmde-markdown_pre_code]:!bg-transparent [&_.wmde-markdown_pre_code]:!p-0 [&_.wmde-markdown_pre_code]:!text-xs",
  "[&_.wmde-markdown_code]:!font-mono [&_.wmde-markdown_code]:!text-xs",
  "[&_a]:!text-primary [&_a]:!underline [&_a]:!underline-offset-2",
);

export interface MarkdownTextProps {
  /** Markdown 文本内容 */
  content: string;
  /** 外层容器 className */
  className?: string;
  /**
   * 渲染尺寸（2026-08-05-skill-content-viewer task-04）：
   * - `compact`（默认）：紧凑型，气泡/历史/日志等小尺寸场景（现有 6+ 处复用）。
   * - `reading`：阅读型，抽屉长文阅读，更大字号/行距。
   */
  size?: "compact" | "reading";
  /**
   * 透传 remark 插件（2026-08-31 变更关联审计 P3）：mdast 层自定义变换
   * （如变更名自动链接 remarkChangeLink）。不传保持现状（sanitize 链路不变，
   * 既有 6+ 处复用零影响）。rehypePlugins 仍固定为本组件单例，不开放透传。
   */
  remarkPlugins?: ComponentProps<typeof MarkdownPreview>["remarkPlugins"];
}

function MarkdownTextInner({ content, className, size = "compact", remarkPlugins }: MarkdownTextProps) {
  if (!content) {
    return null;
  }
  const base = size === "reading" ? READING_CLASS : COMPACT_CLASS;
  return (
    <div className={cn(base, className)}>
      <MarkdownPreview
        source={content}
        components={previewComponents}
        rehypePlugins={markdownRehypePlugins}
        remarkPlugins={remarkPlugins}
      />
    </div>
  );
}

/**
 * ql-20260903-025：memo——流式 delta 期间父树每次重渲染，未变化内容的历史
 * markdown 块跳过 remark parse + rehype-sanitize 全链重解析（累计全文重解析
 * 是流式卡顿主源之一；plugins/components 为模块单例，默认 props 稳定即命中）。
 * 传内联 remarkPlugins 数组的调用方不命中（引用每次新建），属调用方自身课题。
 */
export const MarkdownText = memo(MarkdownTextInner);
