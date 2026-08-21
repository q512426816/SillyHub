"use client";

/**
 * TreeBox · antd Tree 的单行滚动容器（统一文件树视觉）。
 *
 * 从 explorer file-explorer.tsx 的树容器抽离（ql-20260821-013-2c1a）：
 * - 整行单行展示：antd blockNode 默认把行钳在容器宽内，长文件名会把图标/后续
 *   元素挤到第二行——treenode 放开为内容宽（w-max + min-w-full）、content-wrapper
 *   强制 flex 单行不换行（ql-20260821-008-fade）
 * - 缩进 16px/层（antd v6 Tree 无 indentSize prop，token 默认 24px 太占地）
 * - 行宽超出容器时本容器 overflow-auto 横向滚动看全名
 *
 * css-in-js 样式注入在 tailwind 之后，同特异性会被 antd 反杀，故覆盖一律带 !
 * 提权（indent-unit 的 w-4 之前没生效就是栽在这）。
 */

import type { ReactNode } from "react";

/** 单行 + 缩进覆盖类（tailwind 任意选择器，! 提权压 antd css-in-js）。 */
export const TREE_SINGLE_LINE_CLASS = `
  [&_.ant-tree-indent-unit]:!w-4
  [&_.ant-tree-treenode]:!w-max [&_.ant-tree-treenode]:!min-w-full
  [&_.ant-tree-node-content-wrapper]:!flex [&_.ant-tree-node-content-wrapper]:!items-center
  [&_.ant-tree-node-content-wrapper]:!whitespace-nowrap
`;

/** antd Tree 单行滚动容器：className 追加布局类（如 min-h-0 flex-1 rounded border）。 */
export function TreeBox({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`overflow-auto ${TREE_SINGLE_LINE_CLASS} ${className}`}>{children}</div>;
}
