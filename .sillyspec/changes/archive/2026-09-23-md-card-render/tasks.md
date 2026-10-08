---
author: qinyi
created_at: 2026-09-23 01:33:44
generated_by: sillyspec-fourpiece-init
change: 2026-09-23-md-card-render
---
# 任务清单（Tasks）

> plan 阶段展开（2026-10-08）：按「实现+单测同卡、禁仪式卡」纪律由 6 项骨架收敛为 2 张卡；手动验收动作并入 task-02 验收标准。

- [x] task-01: 新建 CardMarkdown 薄壳组件（MarkdownText compact + 表格横向滚动 + 字号对齐 + 表头品牌色）+ card-markdown.test.tsx 单测 [model:sonnet] (target_files: NEW:frontend/src/components/knowledge/card-markdown.tsx, NEW:frontend/src/components/knowledge/__tests__/card-markdown.test.tsx)
- [x] task-02: entry-card-list.tsx 渲染接入与卡片头视觉重构——4 处正文换 CardMarkdown、manual/SingleCard 卡片头重构（brand 色条+头底+锚点复制图标+🔥 收敛+data-entry-anchor 保留）、parseFrontmatterMeta 元信息条（缺失降级）、entry-card-list.test.tsx 回归更新 (depends_on: task-01) [model:sonnet] (target_files: frontend/src/components/knowledge/entry-card-list.tsx, frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx)
