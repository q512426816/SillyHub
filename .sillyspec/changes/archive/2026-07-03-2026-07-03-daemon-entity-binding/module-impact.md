---
author: qinyi
created_at: 2026-07-03 17:45:00
change: 2026-07-03-daemon-entity-binding
stage: archive
---

# 模块影响 — 守护进程实体化绑定

## 变更性质

引入 `daemon_instances` 守护进程实体（稳定身份：本地 uuid + server_url 隔离），`daemon_runtimes` 退化为从属清单；workspace per-member 绑定从 runtime_id 改 daemon_id；daemon 注册/WS Hub/心跳从 per-runtime 改 per-daemon；派发按 daemon_id + workspace.default_agent 解析。WS/register/heartbeat body 全 breaking（D-007 同步升级）。

## 影响模块

### backend

| 模块/文件 | 影响 |
|---|---|
| `daemon/model.py` | 新增 `DaemonInstance`；`DaemonRuntime` 加 daemon_instance_id FK + 移除 os/arch/allowed_roots/capabilities/display_alias |
| `daemon/runtime/service.py` | `register_runtime`→`register_daemon`（upsert daemon_instances + 各 runtime + stale 清理）；`heartbeat`→`heartbeat_daemon`；`cleanup_stale_runtimes` 改 daemon_instances 维度联动；update_runtime/update_allowed_roots 改挂 daemon_instance；新增 `list_instances` |
| `daemon/ws_hub.py` | `_connections` 键 runtime_id→daemon_instance_id；全方法签名 daemon_id；connected_daemon_ids |
| `daemon/router.py` | register 端点返 DaemonRegisterResponse；heartbeat 端点 per-daemon；ws 握手 daemon_local_id + payload 校验；新增 GET /api/daemon/instances |
| `daemon/protocol.py` | WS_HANDSHAKE_QUERY_PARAM=daemon_local_id |
| `daemon/schema.py` | DaemonRegisterRequest/Response per-daemon；DaemonInstanceRead；DaemonRuntimeRead optional 化移除字段 |
| `daemon/session/service.py` | ws_hub 调用经 _resolve_daemon_id_for_runtime 适配 |
| `daemon/lease/context.py` | build_claim_payload 读 daemon_instance.capabilities（runtime.capabilities 已移） |
| `daemon/service.py` | facade register_daemon/heartbeat_daemon/list_instances |
| `workspace/member_runtimes/` | model 加 daemon_id；resolver 返 daemon_id；service PUT /my-binding 写 daemon_id |
| `spec_workspace/` | router/service/bootstrap ws_hub 调用 daemon_id 适配 |
| `agent/placement.py` | _resolve_dispatch_runtime/_resolve_decide_runtime 改 daemon_id + default_agent + D-008 NoOnlineDaemonError |
| `agent/service.py` | send_session_control/send_wakeup daemon_id；start_init_dispatch 读 binding.daemon_id |
| `runtime/service.py` | _resolver_for daemon-client 强制 spec_root（task-16） |
| `migrations/versions/` | 202607031200/1301/1302 三个迁移（建表+加列+移列+索引） |

### sillyhub-daemon

| 文件 | 影响 |
|---|---|
| `src/config.ts` | per-server config-<hash>.json + 旧 config 迁移 |
| `src/daemon.ts` | _registerOne→_registerDaemon；_wsClients Map→单 _wsClient；心跳合并单条 |
| `src/hub-client.ts` | register/heartbeat body per-daemon |
| `src/ws-client.ts` | 握手 URL ?daemon_local_id= |

### frontend

| 文件 | 影响 |
|---|---|
| `components/workspace-daemon-switcher.tsx` | 下拉选 daemon_instances + provider 徽标 + upsert daemon_id |
| `lib/workspace-binding.ts` | MemberBindingView/UpsertRequest daemon_id |
| `lib/daemon.ts` | DaemonInstanceRead 类型 + listDaemonInstances |
| `workspaces/[id]/page.tsx` | default_agent 独立选择器（绑定 daemon 在线 provider） |
| `workspaces/[id]/agent/page.tsx` | 发起 run provider 单次覆盖 |

## 部署影响

- **Breaking**：WS 握手/register/heartbeat body 三端同步升级（D-007），旧 daemon 被拒
- 数据：推荐重置（cleanup 脚本清空 daemon_runtimes/workspace_member_runtimes 旧数据）
- 回退：deploy-guide.md §9 提供回退路径（backend+daemon 回旧版 + 恢复 daemon_runtimes 备份）
- 详见 `deploy-guide.md`
