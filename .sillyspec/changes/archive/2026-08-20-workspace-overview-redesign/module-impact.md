---
author: qinyi
created_at: 2026-08-20T16:10:00+08:00
---

# 模块影响分析（Module Impact）— 工作区详情页工作台式重构

依据：design.md §5 文件变更清单 + plan.md 任务列表，对照 `_module-map.yaml` 模块路径映射。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 修改 | 单页面重构：`workspaces/[id]/page.tsx` 重排为四段式编排层（hook/业务逻辑零改动）+ `page.test.tsx` 断言同步与新增；新增 3 个纯展示组件（workspace/hero-header、stats-row、quick-entry-grid）。不改任何 API 调用/数据流/子模块页面 |
| backend | 无影响 | 零文件变更 |
| sillyhub-daemon | 无影响 | 零文件变更 |
| docs | 无影响 | 无文档改动（FRONTEND_PAGE_STYLE.md 已含 §0.5 主题系统，本次复用不新增规范） |

## 未匹配文件

无（5 个文件全部落在 frontend 模块 path `frontend/` 下）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend.md` | 无需更新（页面级重构不改模块契约/关键逻辑索引——四段式属页面实现细节，组件复用性待后续其它页面采纳时再入卡） | n/a |
