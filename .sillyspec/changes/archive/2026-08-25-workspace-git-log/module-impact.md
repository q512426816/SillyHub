---
author: qinyi
created_at: 2026-08-25 21:33:20
change: 2026-08-25-workspace-git-log
---
# 模块影响分析（Module Impact）— 工作区 Git 日志视图（类 IDEA Git Log）

> 首版生成于 plan 审查步（输入：design.md §6 文件变更清单 + plan.md 任务列表）；execute/verify 阶段按实际代码变更更新，archive 终审。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 新增 | 新模块 `backend/app/modules/git_log/`（router/service/schema/graph_layout/tests 六文件，task-02/03/04）；`app/main.py` 追加 include_router 一行（task-02）；`backend/openapi.json` 随端点新增再生成（task-05） |
| frontend | 修改 | 新页面 `workspaces/[id]/git-log/` + 新组件目录 `components/git-log/`（五组件 + 测试，task-05/06）；`components/workspace-tabs.tsx` TABS 追加一项（task-06）；`lib/git-log.ts` 新增（task-05）；`lib/api-types.ts` 再生成（task-05） |
| sillyhub-daemon | 修改 | `src/host-fs-handler.ts` 新增四只读方法（task-01）；`src/daemon.ts` 平名注册四行（task-01） |
| sillyspec | 修改 | `.sillyspec/local.yaml` modules 块补 git_log 映射（task-02，Plan Review I-1） |

## 未匹配文件

无（design §6 全部 20 项文件均已匹配到上述四模块；prototype-workspace-git-log.html 等变更目录内产物不属源码文件，不入矩阵）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `multi-agent-platform/modules/backend.md` | 契约摘要新增「工作区 Git 日志」条目（三 GET 端点 / WORKSPACE_READ 门控 / probe 三态映射 / 平名 RPC 直连 / compute_lanes / 404-403-502-504-422 错误映射）+ 关键逻辑领域模块清单补 git_log（2026-08-25-workspace-git-log 标注） | done |
| `SillyHub/modules/frontend_app.md` + `frontend_components.md` + `frontend_lib.md`（原计划粗卡 frontend.md，实际按卡覆盖面落位 SillyHub 三卡） | frontend_app 工作区子路由组加 git-log 行（页面定位 + 组件/hooks 指引）；frontend_components 工作区域加 git-log/ 目录条目（commit-graph / commit-list / commit-detail-drawer / file-tree 四组件 + workspace-tabs 追加「Git 日志」）；frontend_lib 领域客户端工作区族补 git-log（三端点 fetch + queryKey 工厂 + useQuery） | done |
| `SillyHub/modules/daemon.md`（daemon 细粒卡在 SillyHub，未动粗卡 sillyhub-daemon.md） | 契约摘要（Node 侧）新增「git 只读四方法」条目：既有十方法清单外新增 gitLog/gitRefs/gitShow/gitDiffFile（共十四）、daemon.ts 平名注册不走 host_fs. 前缀、%x00/%x1e 解析 / 64KB 截断 / 空仓库空态要点 | done |
| `multi-agent-platform/modules/sillyspec.md` | MANUAL_NOTES 追加一句：local.yaml modules 块补 git_log 子模块映射（对齐 2026-08-20 runtime 先例，Plan Review I-1） | done |
| `_module-map.yaml` | 无变化（未增删模块，仅既有模块内文件新增） | skipped |
