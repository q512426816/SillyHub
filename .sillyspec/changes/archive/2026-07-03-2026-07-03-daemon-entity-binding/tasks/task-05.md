---
id: task-05
title: 注册流程改造为 per-daemon（_registerDaemon + register_daemon upsert）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-01, task-02, task-04]
blocks: [task-07]
allowed_paths: [sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/hub-client.ts, backend/app/modules/daemon/runtime/service.py, backend/app/modules/daemon/router.py, backend/app/modules/daemon/schema.py]
---
## goal
> daemon 启动一次性上报 daemon_local_id + providers 列表，backend 先 upsert daemon_instances 再为每 provider upsert daemon_runtimes 并清理 stale runtime。
## implementation
- daemon.ts `_registerOne` 重构为 `_registerDaemon`（design §5.2）：loadConfig 取 daemon_local_id，agent-detector 探测 provider 列表，单次 POST /register 上报整体 body。
- hub-client.ts register body 改为 `{ daemon_local_id, server_url, hostname, os, arch, allowed_roots, providers: [{provider, version, status}] }`。
- backend schema.py 新增/改造 `DaemonRegisterRequest` DTO（含 daemon_local_id + providers 数组）。
- runtime/service.py `register_runtime` 重构为 `register_daemon`：先 upsert daemon_instances by (user_id, server_url, daemon_local_id) 更新机器级字段；再为每 provider upsert daemon_runtimes by (daemon_instance_id, provider)；删除该实例下本次未上报的 stale runtime（provider 卸载，design §9.2）。
- 返回 `{ daemon_instance_id, runtimes: [{provider, runtime_id}] }` 供 daemon 侧缓存 runtime_id（WS payload 标识 provider 会话）。
## acceptance
- 单个 daemon 注册后 daemon_instances 恰好 1 行、daemon_runtimes N 行（N=探测 provider 数），均挂同一 daemon_instance_id（验收 1）。
- 换 hostname 重启 daemon → daemon_instances.id 不变（复用 daemon_local_id）（验收 2）。
- provider 卸载重注册后，对应 daemon_runtimes 行被删除（stale runtime 清理）。
## verify
- `cd backend && uv run pytest app/modules/daemon -k "register_daemon or register"`
- `cd sillyhub-daemon && pnpm test`
## constraints
- 严格依据 design §5.2 注册流程 + §9.1 registered 事件契约 + decisions D-001（daemon_local_id 身份）+ D-006（per-daemon 注册）。
- WS breaking 兼容（D-007）：旧 daemon 仍按 per-provider register body 上报 → backend 按 daemon_local_id 必填校验失败 → 拒绝注册，日志提示同步升级 daemon。
- daemon_runtimes.user_id 保留（与 daemon_instance.user_id 冗余一致，便于查询，不删）。
- 调用方覆盖：register 端点路径不变，仅 body 字段变更；不影响 lease/change_write（D-003 不动）。
