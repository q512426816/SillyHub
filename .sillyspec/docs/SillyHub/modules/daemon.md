---
author: qinyi
created_at: 2026-06-21T23:10:00
---

# daemon
> 最后更新：2026-06-21
> 最近变更：ql-20260621-012-7d4a（运行时移除 + DTO 扩展）
> 模块路径：backend/app/modules/daemon/**

## 职责

Daemon 运行时管理：daemon 注册/心跳、任务 lease 生命周期、交互式会话（create/inject/interrupt/end/reopen）、工具权限审批（canUseTool 远程人审 + AskUserQuestion 对话）、WS RPC（list_dir 等）。

## 当前设计

```
router.py           ── HTTP 入口，挂载到 /api/daemon
service.py          ── DaemonService（runtime/lease/session 业务逻辑 + SQL）
permission_service.py ── 工具审批 + AskUserQuestion 对话收口
ws_hub.py           ── daemon WebSocket 连接管理 + RPC 转发
model.py            ── DaemonRuntime / DaemonTaskLease（SQLModel）
schema.py           ── Pydantic DTO（DaemonRuntimeRead 等）
```

## 运行时管理端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /daemon/register | daemon 注册（user+provider+name 幂等） |
| POST | /daemon/heartbeat | HTTP 心跳（WS 不可用时回退） |
| GET | /daemon/runtimes | 列当前用户运行时（先 cleanup_stale） |
| GET | /daemon/runtimes/{id} | 单运行时详情 |
| POST | /daemon/runtimes/{id}/disable | 禁用（不删，停止 placement） |
| POST | /daemon/runtimes/{id}/enable | 启用（心跳新鲜才 online） |
| POST | /daemon/runtimes/{id}/offline | daemon 优雅关闭标记 offline |
| DELETE | /daemon/runtimes/{id} | 物理删除（级联清 leases/sessions；ql-012） |

- 运行时管理 UI 端点用 `runtime:admin` 权限；daemon 自身注册/心跳/lease 走 `get_current_principal`。
- `DaemonRuntimeRead` 含 id/name/provider/version/os/arch/status/last_heartbeat_at/capabilities/created_at/updated_at。
- 物理删除依赖 DB `ondelete=CASCADE`：`daemon_task_leases.runtime_id` 与 `agent_sessions.runtime_id` 级联清除；daemon 下次心跳重新注册为新 runtime。

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-21 | ql-20260621-012-7d4a | 新增 DELETE /runtimes/{id}（物理删除 + 级联）+ DaemonRuntimeRead 暴露 os/arch |
