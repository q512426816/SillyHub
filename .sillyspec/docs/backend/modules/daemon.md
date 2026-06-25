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
- `GET /api/daemon/runtimes`：读取当前用户可见的运行时（兼容旧调用，仍返回数组）。
- `GET /api/daemon/runtimes/page`：平台管理员分页查询全部 owner 的 runtime（`q/type/status/user_id/limit/offset`），普通账号仅查自己；固定路径必须声明在 `/runtimes/{runtime_id}` 前（D-005），返回 `{items,total,limit,offset}`。
- `PATCH /api/daemon/runtimes/{id}`：更新 `display_alias`（省略=不变、null/空白=清空、非空字符串=更新）；`get/disable/enable/delete/update` 接收 `is_platform_admin` 实现跨 owner 管理（D-001）。
  - 以上三项来自 2026-06-25-admin-global-daemon-workspace-management。
- `DELETE /api/daemon/runtimes/{id}`：物理删除 runtime 及其 lease/session（FK CASCADE）；被未软删 workspace 绑定时返回 409（`DaemonRuntimeInUse`，需先解绑），越权/不存在统一 404。
- `GET /api/daemon/sessions`：按用户隔离并分页读取交互式会话。
- `DELETE /api/daemon/sessions/{id}`：仅删除当前用户的终态会话；活动会话返回 409，越权与不存在统一返回 404。

## 关键逻辑

- 会话状态 `pending/active/reconnecting` 视为活动态，必须先结束再删除。
- 删除会话前显式清空关联 `AgentRun.agent_session_id`，保留 AgentRun 与 AgentRunLog 作为运行历史。
- 所有会话查询和写入都以 `AgentSession.user_id` 在数据库层隔离。

### 交互式会话 provider 语义（D-003@v1, D-007@v1）

- `SessionService.reopen_session()` 的 provider gate 从 `session.provider != "claude"` 扩为 `session.provider not in {"claude", "codex"}`；非支持 provider 仍抛 `DaemonSessionResumeUnsupported`，文案改为 "only claude/codex interactive sessions can be resumed"（D-003@v1, D-007@v1）。
- `AgentSession.agent_session_id` 语义按 provider 区分：Claude 保存 Claude SDK session id，Codex 保存 Codex thread id（D-007@v1）。reopen/reconnect 的 lease metadata 补齐 `session_id` / `agent_session_id` / `provider` / `claim_token`。
- `create_session()` / `inject_session()` / `interrupt_session()` / `end_session()` 按 `AgentSession` / `AgentRun` / interactive lease 建模，不需要 provider 专属表；`AgentSession.provider` 已存在，数据库无需新增列。

### Flat message 与 dialog_kind 通道（D-004@v1, D-006@v1, D-008@v1）

- `RunSyncService.submit_messages()` 接收 Codex driver 上报的 flat message（`event_type` + `content` + `metadata` + `session_id`），与 Claude SDK raw message 展开走同一落库路径；Codex driver 不把 app-server schema 泄漏到 backend（D-004@v1）。
- 审批/dialog 仍以 `PERMISSION_REQUEST` / `PERMISSION_RESPONSE` 作 provider-neutral 通道；Codex 的 `item/tool/requestUserInput` 与 `mcpServer/elicitation/request` 复用同一通道，`dialog_kind` 分别标记 `codex_request_user_input` 与 `mcp_elicitation`（D-006@v1, D-008@v1）。
- `ask_user_only=true` 时普通 command/file/permission 审批 allow-through，只阻塞用户输入/可归一化 MCP elicitation；`ask_user_only=false` 时普通审批走前端审批卡。MCP elicitation 复杂 schema 暂不支持（daemon 侧 fail-closed 并上报 error log）。

## 注意事项

- `display_alias`：runtime 新增 nullable `display_alias VARCHAR(200)`，搜索（ilike）与卡片标题优先用它，空值回退 name/provider（2026-06-25-admin-global-daemon-workspace-management，D-002）。
- 路由顺序：`/runtimes/page`、`/runtimes/usage` 等固定路径必须声明在 `/runtimes/{runtime_id}` 前，否则 FastAPI 把 `page` 当 UUID 解析返回 422（D-005）。
- 跨 owner 管理：`get/disable/enable/delete/update` 接收 `is_platform_admin`，平台管理员可操作任意 owner 的 runtime，普通账号仍受 owner 限制（D-001）。
- owner 展示：列表 owner 由 LEFT JOIN users 填充（OwnerRead 嵌套 DTO，D-006），详情端点 owner 可为 None。

## 变更记录

- 2026-06-19-runtimes-layout：增加终态会话安全删除能力及所有权、状态冲突和运行历史保留测试。
- 2026-06-22-daemon-service-split：将 `DaemonService` 巨石（~3500 行/51 方法）按生命周期拆为 `runtime/lease/run_sync/session/patch` 5 子域子包，`DaemonService` 退化为 facade（方法签名不变、`router.py` 零改动、行为不变）；异常类按子域迁入子包 + facade re-export 保持 import 路径兼容；`DaemonLeaseService` 原位不动（D-003）。跨子域调用经 facade 引用注入（D-006），子 service import 经 `__init__` 内 lazy import 避免 module-level 循环（D-005）。
- ql-20260623-001-85ac | 修复 ruff N815：`DaemonVersionResponse` 的 `minRequired`/`downloadUrl` camelCase 字段（对外公开端点 GET /api/daemon/version 的 JSON 契约，router.py:72-75 注释，install.sh/前端消费）加 `# noqa: N815` 行内豁免，不改 snake_case（改了会破坏 install.sh/前端）；验证 `cd backend && uv run ruff check .` 通过。
- 2026-06-23-codex-interactive-session | `SessionService.reopen_session` provider gate 放开 Codex（`{claude,codex}`，D-003@v1/D-007@v1），`DaemonSessionResumeUnsupported` 文案更新；`AgentSession.agent_session_id` 对 Codex 明确为 thread id；flat message 契约与 `dialog_kind`（`codex_request_user_input` / `mcp_elicitation`）通道对 Codex 生效（D-004@v1/D-006@v1/D-008@v1）；Claude 既有 reopen/permission 测试不变。
- ql-20260625-001-b9e4 | `RuntimeService.delete_runtime`（`runtime/service.py`）删前检查未软删 workspace 绑定：`workspaces.daemon_runtime_id` FK 是 RESTRICT（`workspace/model.py:72` + migration `202607030900` 设计意图，R-06 cascade out of scope），被绑定时抛新增 `DaemonRuntimeInUse`（`HTTP_409_DAEMON_RUNTIME_IN_USE` + 中文提示 + `details.workspaces` 列表）而非让 PG IntegrityError 冒泡成 500；facade re-export 同名异常保持 import 路径；物理删除语义不变。
- ql-20260625-002-7c3a | `delete_runtime` 补软删 workspace 引用处理：ql-001 只查未软删绑定，但 workspace 软删不清 `daemon_runtime_id`，PG FK RESTRICT 不看 `deleted_at` 仍拦截 DELETE → 500（SQLite 测试 FK 不严漏网，PG 生产暴露，dialect 差异）。修复：未软删绑定保持 `DaemonRuntimeInUse`(409)；软删引用（`deleted_at IS NOT NULL`）应用层 `UPDATE workspaces SET daemon_runtime_id=NULL` 解绑绕过 FK → 删 runtime。测试补 `ws.daemon_runtime_id is None` 断言。
