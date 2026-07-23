---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-09
title: problem-list/page.tsx 操作列重构 + 接入新弹窗
wave: 2
blockedBy: [task-08, task-12]
allowed_paths: [frontend/src/app/(dashboard)/ppm/problem-list/page.tsx]
acceptance: [FR-3, FR-4, FR-13]
---

## 目标
操作列对齐任务计划（开始/执行/详情/编辑/删除），删内联只读详情 Modal + 处置 Drawer 入口，详情/执行统一走 `ProblemDetailModal`。

## 实现步骤
1. 操作列（参照 `task-plans/page.tsx:409-454` 的 `canOperate`/`canEdit` 模式）：
   - `canOperate = isOwner(duty_user_id or find_by) || is_platform_admin`；
   - `status==="新建"` + canOperate →「开始」按钮 → `startProblem(id)` 刷新；
   - `status==="进行中"` + canOperate →「执行」按钮 → `setDetailProblem(p); setDetailMode("execute")`；
   - 任意态 →「详情」→ `setDetailProblem(p); setDetailMode("detail")`；
   - 任意态 →「编辑」→ 打开 `_problem-drawer` mode=edit（D-004 任意态可改基本信息）；
   - 任意态 + (isOwner||admin) →「删除」→ `deleteProblem`。
2. 删：内联只读详情 `Modal`（`page.tsx:612-634`）+ 处置 `_problem-drawer` done/change 触发 +「提交」「变更」旧按钮（`:400-416`）+ problem-change 入口。
3. 渲染 `<ProblemDetailModal problem={detailProblem} mode={detailMode} onClose={...} onChanged={刷新} />`。
4. 状态 Tag 用 `effective_status`（=status 中文 3 态，task-12 映射）。

## 测试点
- 新建态显示「开始」无「执行」；进行中显示「执行」无「开始」；已完成只有「编辑/详情/删除」。
- 非本人非管理员无「开始/执行/删除」。
- 开始 → startProblem → 列表刷新变进行中。

## 验收
- 操作列三态按钮正确；详情/执行走 ProblemDetailModal；lint/typecheck 绿。
