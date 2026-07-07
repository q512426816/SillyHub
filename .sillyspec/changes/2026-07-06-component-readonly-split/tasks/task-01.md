---
id: task-01
title: 前置 grep 调用方登记（reparse / generate_projects / relation / change_workspaces）
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: []
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths: []
goal: >
  在动代码前，全局 grep 所有被砍/被改符号的调用方并登记清单，避免 task-04/05/06 删方法/模型后留死调用（覆盖 R-03 风险）。
implementation:
  - 在仓库根对以下符号做 grep（含 backend + frontend + 任何脚本）：`reparse`、`generate_projects`、`_sync_change_workspaces`、`WorkspaceRelation`、`ChangeWorkspace`、`getWorkspaceRelations`、`/relations`、`/reparse`
  - 每个命中点逐条登记：文件:行号 + 调用语义（读/写/只是文案）+ 本次变更后应如何处理（删/改调/保留）
  - 产出清单作为 task-04/05/06/08 的 implementation 输入，无命中也记一笔
acceptance:
  - grep 覆盖 backend 与 frontend 两侧，无遗漏目录
  - 每个命中点都有"如何处理"结论，能被后续 task 直接消费
verify:
  - ripgrep 命令可重复执行（在 goal 描述里固化符号列表）
constraints:
  - 本任务只读 grep + 写清单，不改任何代码
  - 清单作为后续 task 的依据，不另存文件（写进各 task implementation）
---

