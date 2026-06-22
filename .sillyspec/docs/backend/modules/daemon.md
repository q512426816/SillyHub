---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-06-19T19:40:00+08:00
---

# daemon

## 定位

管理本地 Daemon 运行时、任务租约、交互式 AgentSession，以及 daemon 与平台之间的 WebSocket/RPC 协议。

## 契约摘要

- `DaemonService`（facade）：现为薄 facade，保留全部历史方法签名不变，内部委托 5 个子域 service（2026-06-22-daemon-service-split 拆分）。
  - `runtime/service.py` → `RuntimeService`：runtime 注册/心跳/启停/清理（含 RPC 异常族 DaemonRpc*）。
  - `lease/service.py` → `LeaseService`：lease 创建/认领/启动/续约/完成/过期/回滚（承接原 `DaemonService.lease_*`）；`lease/context.py` → `build_claim_payload` 模块级函数。
  - `run_sync/service.py` → `RunSyncService`：AgentRun 状态同步 / 交互式 run 关闭 / 消息提交 / post-scan 校验。
  - `session/service.py` → `SessionService`：AgentSession 创建/注入/中断/结束/恢复/重连/查询（最大子域，含 recover_*/confirm/mark 三方法供 fix-interactive-daemon-lifecycle W4 接通）。
  - `patch/service.py` → `PatchService`：worktree diff 应用。
- `DaemonLeaseService`（`lease_service.py`）：独立活 service，`cancel_lease` 被 agent 模块跨模块调用（`agent/service.py:545`），原位保留，与本次 `LeaseService` 分管 lease 不同操作（D-003）。
- 异常类/状态常量已迁入对应子包定义，facade `service.py` 集中 re-export，`from app.modules.daemon.service import XxxError` 路径不变（FR-05）。
- `GET /api/daemon/runtimes`：读取当前用户可见的运行时。
- `GET /api/daemon/sessions`：按用户隔离并分页读取交互式会话。
- `DELETE /api/daemon/sessions/{id}`：仅删除当前用户的终态会话；活动会话返回 409，越权与不存在统一返回 404。

## 关键逻辑

- 会话状态 `pending/active/reconnecting` 视为活动态，必须先结束再删除。
- 删除会话前显式清空关联 `AgentRun.agent_session_id`，保留 AgentRun 与 AgentRunLog 作为运行历史。
- 所有会话查询和写入都以 `AgentSession.user_id` 在数据库层隔离。

## 变更记录

- 2026-06-19-runtimes-layout：增加终态会话安全删除能力及所有权、状态冲突和运行历史保留测试。
- 2026-06-22-daemon-service-split：将 `DaemonService` 巨石（~3500 行/51 方法）按生命周期拆为 `runtime/lease/run_sync/session/patch` 5 子域子包，`DaemonService` 退化为 facade（方法签名不变、`router.py` 零改动、行为不变）；异常类按子域迁入子包 + facade re-export 保持 import 路径兼容；`DaemonLeaseService` 原位不动（D-003）。跨子域调用经 facade 引用注入（D-006），子 service import 经 `__init__` 内 lazy import 避免 module-level 循环（D-005）。
