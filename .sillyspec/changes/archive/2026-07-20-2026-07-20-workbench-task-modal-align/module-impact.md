---
author: qinyi
created_at: 2026-07-20T11:15:00
---

# module-impact.md — 工作台「我的任务」操作弹窗对齐任务计划页

> 变更 `2026-07-20-workbench-task-modal-align` · 以 git diff 为准（真实 > 声明）

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| frontend | 逻辑变更 + 新增 + 删除 | 见下表 | 抽公共 TaskDetailModal 组件，任务计划页 + 工作台两页复用；工作台启动改只切状态；删孤儿 ExecuteTaskDialog | false |

## frontend 模块文件清单（本变更 design.md §6 范围）

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx` | 公共任务详情 Modal（antd width=760，自管 listTaskExecutes 拉记录/跨天拆分/handleDetailExecute 提交） |
| 修改 | `frontend/src/app/(dashboard)/ppm/task-plans/page.tsx` | 删内联 Modal + handleOpenDetail/handleDetailExecute/相关 state + 遗留 handleResume + ExecuteTaskDialog 引用，替换为 `<TaskDetailModal>`（抽取型零行为变更） |
| 修改 | `frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx` | 接入 `<TaskDetailModal>`（详情→detail / 执行→execute）；handleStart 改只切状态（startPlanTask+toast，不弹窗）；删只读 Dialog + ExecuteTaskDialog 引用 |
| 删除 | `frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx` | 孤儿文件（两页改用 TaskDetailModal 后全仓 grep 零引用） |

## 未匹配文件

无。所有本变更改动均在 `frontend/**` 下，全部命中 frontend 模块（`_module-map.yaml` paths: `frontend/**`）。无 backend / sillyhub-daemon / deploy 改动。

## 附注：同期未 commit 的样式阶段改动（非本变更范围）

`git diff --name-only HEAD` 另含 `ql-20260720-001-9f3c`（工作台样式美化 quick）+ `ql-20260720-002-cleanup`（unused 清理）涉及的文件，属另两个 quick 范畴，不在本变更 module-impact 矩阵内，但同样命中 frontend 模块：

- `workbench/_components/profile-summary-card.tsx` / `personal-metric-strip.tsx` / `todo-list-panel.tsx` / `message-placeholder.tsx` / `work-calendar-panel.tsx` / `quick-entry-grid.tsx` / `workbench/page.tsx`（ql-001 样式）
- `task-plans/page.tsx` / `workbench-task-table.tsx` 的 cleanup 部分已并入本变更文件清单（ql-002）

这些将在最终统一提交时一并 commit；frontend.md 变更索引会追加本变更 + ql-001 + ql-002。
