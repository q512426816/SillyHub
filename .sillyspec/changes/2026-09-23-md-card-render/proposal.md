---
author: qinyi
created_at: 2026-09-23 01:33:44
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
`/workspaces/[id]/scan-docs` 与 `/workspaces/[id]/knowledge` 两页「卡片」视图是知识资产的主要浏览入口，但卡片正文按 markdown 源文本原样显示（`#`、`**`、`|表格|` 裸露，表格不渲染），阅读体验差，知识资产价值打折。项目内已有成熟统一的 md 渲染组件（MarkdownText，两页「原文」tab 即其效果），卡片模式未接入。

## 关键问题
1. **可读性**：md 标记原样裸露，表格/代码/加粗全部失效，用户需要脑内"反编译"源文本。
2. **能力浪费**：统一渲染组件（含安全过滤、双主题适配）已存在且全仓 16 处复用，卡片模式重复欠账。
3. **卡片视觉扁平**：小节卡无品牌感与元信息（作者/时间），与平台 AI-Native 双主题设计系统未对齐。

## 变更范围
- 新建 `CardMarkdown` 薄壳组件（包 MarkdownText compact + 表格横向滚动 + 字号对齐 + 表头品牌色）；
- `entry-card-list.tsx` 4 处纯文本正文接入渲染 + manual 卡/SingleCard 卡片头视觉重构（品牌色条、brand-50 头底、锚点复制图标、frontmatter 元信息条、🔥 徽标收敛）；
- DecisionCard 仅正文/理由块接入渲染（结构不动）；
- 配套测试与回归（锚点跳转 / frontmatter 降级 / 双主题）。
- 视觉基准：`prototype-card-render.html` panel-c（用户已确认）。

## 不在范围内（显式清单）
- 不做「原文」tab 改造（已正常渲染）
- 不做后端任何改动（API / 表结构 / 解析）
- 不做 INDEX 路由行的 md 渲染（导航元素）
- 不做 DecisionCard 头部视觉重构（保持现有专属结构）
- 不做移动端 `m/` 页面
- 不向 `.sillyspec/knowledge/conventions.md` 沉淀新约定（仅作原型演示样本，D-001）
- 不做折叠/展开与卡片内二级滚动交互（D-002）

## 成功标准（可验证）
- 卡片模式下，conventions.md 等知识/扫描文档的表格、列表、加粗、行内代码正常渲染（对照原型 panel-c）；
- 4 处正文渲染均经过统一 rehype-sanitize 安全过滤；
- INDEX 路由行跳转卡片锚点定位不回归；双主题（blue / ai-native）下色条/表头色正确换肤；
- 无 frontmatter 的文件元信息条自动隐藏、卡片正常渲染；
- `pnpm -C frontend test`（knowledge 相关）+ `pnpm -C frontend exec tsc --noEmit` + lint 通过。
