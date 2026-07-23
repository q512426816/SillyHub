---
author: qinyi
created_at: 2026-07-10 22:38:00
---

# 提案书（Proposal）— 移除工作区 server-local 模式

## 动机

daemon-entity-binding 落地后，工作区绑定已从 runtime 改为 daemon 实体，`server-local` 路径在生产中被完全旁路。但全栈仍保留大量 `if path_source == "server-local"` 分支与 `HostFsDelegate` 的本地实现，构成维护负担与认知噪声。统一为单一 daemon-client 模式。

## 关键问题（现有方案为什么不够）

1. **维护负担**：约 50 个文件含 path_source 分流逻辑，每次相关改动都要维护两条路径，易遗漏（如 daemon-runtime-service.py:727-730 的 UPDATE daemon_runtime_id SQL）。
2. **死代码积累**：HostFsDelegate 的 6 个 `_local_*` 方法 + `_run_git_apply` + `daemon_runtime_id` legacy 列实际无生产调用（server-local acquire 已旁路），但仍占测试覆盖与认知成本。
3. **认知噪声**：新建工作区两种模式选择增加用户理解成本，实际只用 daemon；admin 才可见的 server-local radio 是无效功能。

## 变更范围

彻底删除 server-local：前端入口 + 后端所有 path_source 分流 + HostFsDelegate 本地方法 + DB `path_source`/`daemon_runtime_id` 两列 + 存量 server-local 工作区数据 + 测试用例。详见 design.md §6 文件变更清单（后端 28 + 前端 19 + daemon 3）。

## 不在范围内（显式清单）

- complete_lease 侧 3 处**容器越界 bug**（apply_patch 500 / post_scan_validation / stage_callback）——属独立 container-overreach 变更（D-003）
- `workspace:admin` 权限枚举 / 菜单绑定 / 角色赋权——保留用于前端菜单显示（D-001）
- daemon 生命周期事件契约（claim/start/complete lease、session create/end）——不改
- daemon-client 工作区的新功能——只删不增
- DB 重置——用标准 alembic 迁移，现有环境可 upgrade

## 成功标准（可验证）

- 生产代码 `server-local`/`path_source`/`daemon_runtime_id` 字样 grep 清零（测试与 archive 除外）
- backend pytest（覆盖率 ≥60%）+ frontend vitest/typecheck + daemon vitest 全绿零回归
- Docker 迁移 upgrade 成功，incident FK 不违约
- 新建工作区只能 daemon-client；存量 server-local 工作区已清除
- daemon-client 路径端到端可用（scan / dispatch / lease / spec-sync）
