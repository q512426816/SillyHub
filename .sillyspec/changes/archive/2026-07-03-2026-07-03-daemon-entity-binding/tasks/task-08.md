---
id: task-08
title: placement 派发改读 binding.daemon_id + provider=default_agent 解析
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-02, task-03]
blocks: [task-10, task-12, task-15]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/service.py
---
## goal
> agent run / decide 派发从 per-member binding 的 daemon_id 出发，按 workspace.default_agent 在该 daemon 在线 runtimes 中命中 runtime（未命中报错不 fallback，D-005/D-008）。

## implementation
- 改 `_resolve_dispatch_runtime`（placement.py:606-773）：workspace 分支读 `binding.daemon_id`（非 runtime_id）；binding.daemon_id 为空 → 报「未绑定守护进程，请重绑」。
- daemon_id → 查 daemon_instances（在线 + 归属 user）→ 该 daemon 的 daemon_runtimes 找 `provider==workspace.default_agent` 且 status==online；命中返回该 runtime（lease.runtime_id 落它）。
- 未命中 → 抛 `NoOnlineDaemonError` 变体，message 含 `default_agent` + 该 daemon 已启用 provider 列表（D-008 不自动 fallback）。
- `_resolve_decide_runtime`（placement.py:805-939）对称改造，覆盖 decide 路径。
- provider 单次覆盖：agent run 发起参数透传 provider 覆盖 default_agent（agent/router.py 发起端点传参，service.py 调用层适配）。
- agent/service.py:1480,1623 的 send_session_control/send_wakeup 调用参数 runtime_id → daemon_id（task-06 WS Hub 签名改后连锁适配；payload 内 runtime_id 标识 provider session）。
- workspace_id is None 分支保持 `_get_online_runtime` 不变；无 binding 行 → fallback legacy `workspaces.daemon_runtime_id`（渐废弃）。

## acceptance
- binding.daemon_id 指向的 daemon 在线、且该 daemon 启用了 default_agent provider → 返回该 runtime，lease.runtime_id 正确落入。
- daemon 在线但 default_agent 未启用 → 派发失败，错误 message 含 default_agent 与已启用 provider 列表，不选其他 provider。
- daemon 离线或 daemon_id 为空（旧 binding 未迁移）→ 派发失败，message 明确指引重绑。
- provider 发起参数覆盖 default_agent 时，按覆盖值在同 daemon 命中 runtime。

## verify
- `cd backend && uv run pytest app/modules/agent -q`
- `cd backend && uv run pytest app/modules/workspace -q`

## constraints
- D-008：default_agent 与 daemon 已启用 provider 不匹配时严禁自动 fallback 到其他 provider（会偏离用户明确配置）。
- lease.runtime_id 仍记录执行 provider（D-003 不变）；不引入 lease.daemon_id 列。
- change-write 端点保持 runtime_id 路径参数（D-003，本 task 不动）。
- 调用方覆盖依赖 task-09 的 MemberBindingResolver 已返回 daemon_id（resolver 改造后 agent/service.py 与 spec_workspace/router.py 两条路径自动覆盖，X-002）。
- 兼容 Windows/Linux/macOS；错误 message 中文。
