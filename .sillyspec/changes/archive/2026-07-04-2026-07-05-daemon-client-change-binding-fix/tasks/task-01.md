---
id: task-01
title: 抽共享 resolve_runtime_for_writeback + placement 查询提取
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/resolver.py
  - backend/app/modules/workspace/member_runtimes/queries.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/workspace/member_runtimes/tests/test_resolver.py
goal: "抽共享 resolve_runtime_for_writeback + placement 查询提取"
implementation: "queries.py 提取三查询为模块级；resolver 新增 resolve_runtime_for_writeback 复刻 placement 六步；NoOnlineDaemonError 转译 DaemonClientNoActiveSession"
acceptance: "五边界行为正确（无 binding/daemon 离线/default_agent 空/命中/无匹配）；placement 测试零回归"
verify: "pytest member_runtimes/tests/test_resolver.py + agent/tests/test_placement_member_binding.py"
constraints: "不改 placement 派发语义；upsert_my_binding 不动"
---

# task-01 — 共享 resolve_runtime_for_writeback + placement 查询提取

## goal
为写回链路提供「daemon_id + default_agent → online runtime」共享解析，复用
placement 已有查询，避免逻辑重复（D-004@v1 / FR-01）。

## 实现步骤
1. 新建 `member_runtimes/queries.py`，把 placement 的三个私有查询方法提取为模块级：
   `query_daemon_online_by_id` / `query_runtime_by_daemon_and_provider` /
   `get_daemon_enabled_providers`（纯查询语义，不改逻辑）。
2. `agent/placement.py` 原方法改为调用模块级函数（保持派发行为不变）。
3. `member_runtimes/resolver.py` 新增 `resolve_runtime_for_writeback(session,
   workspace_id, user_id) -> DaemonRuntime`，复刻 placement.py:702-749 六步逻辑
   （无 provider override 分支）。
4. 内部 `NoOnlineDaemonError` 转译为 `DaemonClientNoActiveSession`（AppError HTTP 400，
   details.reason 区分：not_bound / daemon_offline / default_agent_unset /
   provider_unavailable）。

## 验收标准
- `resolve_runtime_for_writeback` 在 binding 缺失/daemon 离线/default_agent 空/命中/无匹配
  五种边界行为正确（§6）。
- placement 现有测试全绿（查询提取零回归）。

## 验证
- `pytest app/modules/workspace/member_runtimes/tests/test_resolver.py`
- `pytest app/modules/agent/tests/test_placement_member_binding.py`（零回归）

## 约束
- 不改 placement 的派发语义（仅提取查询函数）。
- `upsert_my_binding` 不动（D-004 binding 不写 runtime_id）。
