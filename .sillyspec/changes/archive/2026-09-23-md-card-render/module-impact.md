---
author: WhaleFall
created_at: 2026-10-08 10:31:22
change: 2026-09-23-md-card-render
generated_by: agent-fallback
---

# 模块影响分析（Module Impact）— md 卡片渲染改造

## 模块影响矩阵

| 文件 | 模块 | 影响类型 | 说明 |
|---|---|---|---|
| frontend/src/components/knowledge/card-markdown.tsx | frontend_components | added | CardMarkdown 渲染薄壳（task-01，a3a40b2e） |
| frontend/src/components/knowledge/__tests__/card-markdown.test.tsx | frontend_components | added | 薄壳单测（task-01） |
| frontend/src/components/knowledge/entry-card-list.tsx | frontend_components | modified | 4 处正文接 CardMarkdown + manual/SingleCard/DecisionCard/INDEX 分组卡片化 + parseFrontmatterMeta 元信息条 + shrink-0 防压缩（task-02 及验收追加 4f..../86..../e5..../322c55edd） |
| frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | frontend_components | modified | 卡片头/元信息/锚点/竞态回归等断言 + 新用例（23 用例） |
| frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend_app | modified | 连带断言改写（卡片正文经 md-preview 渲染，9d96984a） |
| frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | frontend_app | modified | selectEntry 竞态守卫 + 中间态切断 + 加载态占位（验收追加 49e28e1cb/323faef56） |
| frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx | frontend_app | modified | requestDoc 竞态守卫（树点击 fetch 上提主组件，验收追加 49e28e1cb） |

## 未匹配文件

（无——7 个代码文件均命中 _module-map.yaml：frontend_components=frontend/src/components/**，frontend_app=frontend/src/app/**。.sillyspec/ 下产物文件（knowledge 踩坑/决策/FR 索引、模块文档）为归档机器产物，不参与模块归属核对。）

## 更新结果

| 目标文档 | 状态 | 备注 |
|---|---|---|
| modules/frontend_components.md | done | knowledge 域新增 card-markdown.tsx 条目 + entry-card-list.tsx 渲染化段（verify 期）；archive 期补验收追加（决策卡/INDEX 卡片化/shrink-0） |
| modules/frontend_app.md | done | 补知识库/扫描文档页选择加载语义（竞态守卫+加载态）一句 |
| _module-map.yaml | skipped | 无新模块/路径模式变更（新文件落在既有前缀内） |
