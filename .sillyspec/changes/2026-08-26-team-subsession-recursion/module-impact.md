---
author: qinyi
created_at: 2026-08-26 03:20:00
---
# 模块影响分析（Module Impact）— 团队分身递归开闸 P2

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | 迁移 20260826020000 tree_depth 列+全表回填；model.py 全树 CTE（task-01） |
| backend | 修改 | mcp_tools.py 五端点解析/递归派发/深度门/层0收口/全树枚举（task-02） |
| backend | 修改 | mission.py 映射增补+全树集合（task-03） |
| backend | 修改 | placement.py worker_depth 写 metadata（task-04） |
| backend | 修改 | daemon/lease/context.py 白名单透传（task-04） |
| backend | 修改 | daemon/run_sync/service.py 失败即收口（task-06） |
| backend | 修改 | patrol.py 预算强收职责⑥（task-07） |
| backend | 修改 | control/finalizer/mission_context/daemon-router 全树换点+简报（task-08） |
| backend | 修改 | schema.py sub_workers_count + openapi/api-types gen:types（task-08） |
| sillyhub-daemon | 修改 | daemon.ts/types.ts/persistence/session-manager.ts 透传链+会话闸（task-04） |
| sillyhub-daemon | 修改 | mcp-server/mcp-config/cli.ts 分层工具集（task-05） |
| backend | 新增 | test_subsession_recursion_* 族 + 8 个既有测试更新（task-09） |
| sillyhub-daemon | 新增 | worker-tiered-toolset / session-limit 测试（task-09） |

## 未匹配文件

无（design §6 清单 20 文件全部命中三模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| modules/backend.md | 待 execute 完成后更新（递归治理链） | pending |
| modules/sillyhub-daemon.md（interactive.md） | 待 execute 完成后更新（分层工具集+会话闸） | pending |
| _module-map.yaml | 无变化（未增删模块） | skipped |
