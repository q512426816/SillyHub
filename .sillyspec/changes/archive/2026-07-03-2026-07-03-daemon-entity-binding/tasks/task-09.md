---
id: task-09
title: MemberBindingResolver 返回 daemon_id + PUT /my-binding 写 daemon_id
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-03]
blocks: [task-10, task-11, task-15]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/resolver.py
  - backend/app/modules/workspace/member_runtimes/service.py
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/bootstrap.py
  - backend/app/modules/agent/service.py
---
## goal
> per-member 绑定的解析与写入统一改 daemon_id：resolver 返回 daemon_id、PUT /my-binding 写 daemon_id，agent run 与 scan/init 两条调用路径经共享 resolver 自动覆盖（D-004/D-005，design §6 X-002）。

## implementation
- 改 `MemberBindingResolver.resolve_member_binding`（resolver.py:13-29）：返回字段从 runtime_id 改 daemon_id（基于 task-03 新增的 workspace_member_runtimes.daemon_id 列）。
- 改 `PUT /my-binding`（service.py）：请求体与写入改 daemon_id（不再写 runtime_id；runtime_id 列保留不写不删，D-004 旧数据快照）。
- 校验入参 daemon_id 存在于 daemon_instances 且归属当前 user，否则 4xx。
- grep 全仓确认 `resolve_member_binding` / MemberBindingResolver 调用方；当前两处：`agent/service.py`（agent run 派发）+ `spec_workspace/router.py`（scan / init lease）。
- 两调用方按新返回字段（daemon_id）适配下游（placement 已在 task-08 改读 daemon_id，scan/init 路径随之解析 daemon → runtime）。
- spec_workspace/service.py（send_rpc）+ bootstrap.py（send_session_control）调用参数 runtime_id → daemon_id（task-06 WS Hub 签名改后连锁适配；payload 内 runtime_id 标识 provider session）。

## acceptance
- PUT /my-binding 写入 workspace_member_runtimes.daemon_id；runtime_id 列不被写入。
- resolver 返回的 daemon_id 可被 task-08 的 placement 正确消费。
- agent run 派发与 spec_workspace scan/init lease 两条路径均走改后 resolver，无第二处硬编码 runtime_id 解析。
- 传入不存在或不归属当前 user 的 daemon_id → 4xx 拒绝。

## verify
- `cd backend && uv run pytest app/modules/workspace -q`
- `cd backend && uv run pytest app/modules/agent -q`
- `grep -rn "resolve_member_binding\|MemberBindingResolver" backend/app` 确认调用方全覆盖。

## constraints
- 调用点覆盖说明（X-002 核心）：agent/service.py 与 spec_workspace/router.py 共享同一 resolver，改 resolver 返回 daemon_id 即自动覆盖两条路径，无需为 scan/init 单独适配绑定解析。
- runtime_id 列保留为 nullable 不删（D-004 YAGNI，未来清理脚本处理）。
- daemon_id FK ondelete=RESTRICT（task-03 设定），删除 daemon 实体前需先解绑成员。
- 不引入「一成员绑多 daemon」（per-member 一行，YAGNI）。
