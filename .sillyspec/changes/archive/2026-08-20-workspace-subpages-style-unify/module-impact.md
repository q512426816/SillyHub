---
author: qinyi
created_at: 2026-08-20T22:40:00+08:00
---

# 模块影响分析（Module Impact）— 工作区子页面样式统一

依据：design.md §6 文件变更清单 + plan.md 任务列表，对照 `_module-map.yaml`。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 修改 | 8 个子页面 page.tsx 展示层统一（ErrorBanner/EmptyState/返链/语义色/表格规格/hover/中文化/容器锚）+ 新增 error-banner.tsx + workspace-session-section/shared-daemon-manager/workspace-member-row 三内嵌组件 + 受影响测试断言同步；零业务逻辑/API 变更 |
| backend | 无影响 | 零文件变更 |
| sillyhub-daemon | 无影响 | 零文件变更 |
| docs | 修改 | FRONTEND_PAGE_STYLE.md 头部适用范围声明（D-304，已在 brainstorm 阶段落盘） |

## 未匹配文件

无（全部落在 frontend 模块 + docs 模块两处）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend.md` | 无需更新（展示层模式统一不改模块契约；ErrorBanner 入卡待后续新组件增多时一并补） | n/a |
