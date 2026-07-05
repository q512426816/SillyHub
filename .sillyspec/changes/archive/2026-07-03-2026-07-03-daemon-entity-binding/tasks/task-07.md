---
id: task-07
title: 心跳 per-daemon（单条心跳带 daemon_local_id + 各 provider 状态，stale 联动 offline）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P1
depends_on: [task-05, task-06]
blocks: [task-15]
allowed_paths: [sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/hub-client.ts, backend/app/modules/daemon/runtime/service.py, backend/app/modules/daemon/router.py]
---
## goal
> daemon 单条心跳合并上报 daemon_local_id + 各 provider 状态，backend 同时更新 daemon_instances.last_heartbeat_at 与各 runtime.status，stale 判定改以 daemon 实体心跳为准。
## implementation
- daemon.ts 并发心跳（`_wsClients` Map 收敛为单条 WS 后，design §5.4/§5.5）合并为单条心跳任务，带 daemon_local_id + `providers: [{provider, status, last_heartbeat_at}]`。
- hub-client.ts heartbeat body 改为 `{ daemon_local_id, providers: [...] }`。
- backend heartbeat 端点接收后：更新 daemon_instances.last_heartbeat_at=now；遍历 providers 更新对应 daemon_runtimes.status（design §9.1 heartbeat 事件）。
- runtime/service.py `cleanup_stale_runtimes`（service.py:491-512）改造：stale 判定从 per-runtime 改以 daemon_instances.last_heartbeat_at 为准（DEFAULT_RUNTIME_STALE_SECONDS=45s）；daemon 实体超时 → daemon_instances.status=offline + 其下所有 daemon_runtimes.status=offline 联动。
## acceptance
- daemon 周期心跳 → 仅 daemon_instances.last_heartbeat_at 刷新，各 runtime.status 跟随 providers 上报值。
- daemon 停跳 >45s → daemon_instances.status=offline，其下所有 runtime.status=offline 联动（验收点对应 §9.1 stale 事件）。
- heartbeat_ack 经 WS 下发到该 daemon 连接（task-06 通路）。
## verify
- `cd backend && uv run pytest app/modules/daemon -k "heartbeat or stale or cleanup"`
- `cd sillyhub-daemon && pnpm test`
## constraints
- 严格依据 design §5.4 心跳 + §9.1 heartbeat/stale 事件契约 + decisions D-006（per-daemon 心跳）。
- WS breaking 兼容（D-007）：旧 daemon 仍按 per-provider 心跳上报 → backend 按 daemon_local_id 必填校验失败；与 task-05/06 一致要求同步升级。
- stale 阈值沿用 DEFAULT_RUNTIME_STALE_SECONDS=45s 不变；daemon offline 联动 runtime offline 后，dispatch 解析会因 runtime.status!=online 触发 D-008 报错路径（与 task-08 衔接）。
- 不引入 runtime 级独立心跳（design §9.2 runtime 无独立心跳）；不删 daemon_runtimes.last_heartbeat_at 列（provider 级 status 快照仍用）。
