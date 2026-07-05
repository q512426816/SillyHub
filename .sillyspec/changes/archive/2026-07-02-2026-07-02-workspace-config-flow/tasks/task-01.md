---
id: task-01
title: MemberBindingResolver 接入 RunPlacementService（per-member 路由）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: []
blocks: [task-02, task-06]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/tests/test_placement_member_binding.py
---

## 目标
scan/agent dispatch 按 actor 的 `WorkspaceMemberRuntime` 路由 runtime_id + root_path，废弃读 `Workspace` 全局 daemon_runtime_id/root_path（D-006）。

## 实现步骤
- 改 `_resolve_dispatch_runtime`（placement.py:602）/ `_resolve_decide_runtime`（:732）：先 `MemberBindingResolver.resolve_member_binding(workspace_id, actor_user_id)` 取 runtime_id+root_path；无 member 行时回退读 `Workspace` 全局列（兼容旧 binding）。
- `prepare_scan_interactive_dispatch`（:137/:209）透传 actor_user_id。

## 验收标准
- 两成员绑定不同 daemon+路径，A 发起 scan 用 A 的 binding 路由（不读全局列）。
- 旧 binding（无 member 行）回退读全局列，不崩。

## 验证方式
`cd backend && uv run pytest app/modules/agent/tests/test_placement_member_binding.py -q`；集成测：两成员不同 binding 路由正确。

## 约束
- `Workspace` 全局列保留只读（member_runtimes/model.py:1-8 已声明 deprecated read-only），不删。
- 不改 `MemberBindingResolver` 自身（已就绪）。
