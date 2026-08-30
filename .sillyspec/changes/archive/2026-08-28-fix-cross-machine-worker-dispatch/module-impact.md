---
author: WhaleFall
created_at: 2026-08-28 15:53:40
---

# 模块影响分析（Module Impact）— 修复跨机器分身派发

> 首版（plan 审查步生成）。execute/verify 按实际代码变更回填「更新结果」，archive 终审。
> 映射依据：`.sillyspec/docs/SillyHub/modules/_module-map.yaml`。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend/agent | 修改 | mcp_tools.py `_dispatch_worker_core`（删 own_rt 优先、恒 binding 钉定、两段式 provider 预检、allowed_roots 可判定越界 400）；placement.py（新增 fetch_daemon_allowed_roots + path_definitively_outside_roots helper）；测试（test_worker_subsession_dispatch 重写+新增、test_placement_member_binding 双源同序） |
| backend/workspace | 修改 | member_runtimes/queries.py（resolve_representative_binding 四 SQL 变体 + resolve_daemon_instance_for_workspace 补全序 ORDER BY，路由查询加 daemon_instances join）；tests/test_representative_binding.py（owner 优先用例按全序新语义更新） |
| sillyhub-daemon | 新增 + 修改 | 新增 src/interactive-cwd-guard.ts（守卫纯函数）+ tests/interactive-cwd-guard.test.ts；修改 src/daemon.ts 认领段（truthy 分支 + 白名单终检先行 + stat 存在性 + notifyRunResult 拒绝不 mkdir；空 rootPath 保留 gap-8 mkdir） |
| frontend | 无变化 | 零文件变更（无对外 API 字段/DTO 变更） |
| backend/build（迁移） | 无变化 | 无表结构变更 |

## 未匹配文件

无（design §6 文件清单 9 文件全部命中上述模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/SillyHub/modules/agent.md` | 已更新（注意事项段新增：分身派发选机唯一钉定/两段式 provider/allowed_roots 预检语义） | done |
| `docs/SillyHub/modules/workspace.md` | 已更新（member_runtimes 段新增：queries 双解析统一全序 D-005@v1） | done |
| `docs/SillyHub/modules/daemon.md` | 已更新（Daemon 类段新增：认领段 cwd 守卫/gap-8 mkdir 收敛/truthy 判定） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
