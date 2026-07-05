---
author: qinyi
created_at: 2026-07-05 00:32:47
change: 2026-07-05-daemon-client-change-binding-fix
stage: brainstorm
---

# Requirements — daemon-client 写回流程对齐 daemon-entity-binding

## 功能需求

| ID | 需求 | 决策 |
|---|---|---|
| FR-01 | 新增共享函数 `resolve_runtime_for_writeback(session, workspace_id, user_id) -> DaemonRuntime`：`MemberBindingResolver` 拿 `binding.daemon_id` → 校验 daemon online + owned → 读 `workspace.default_agent` → 在该 daemon 下找匹配 provider 的 online runtime；找不到抛 `NoOnlineDaemonError`（不 fallback，D-008 一致）。复用 placement 的查询函数（`_query_daemon_online_by_id` / `_query_runtime_by_daemon_and_provider` / `_get_daemon_enabled_providers`），抽到共享位置 | D-004 |
| FR-02 | `change_writer/proxy.py` `proxy_create_change` 删 `workspace.daemon_runtime_id != runtime_id` 死校验；改调 `resolve_runtime_for_writeback` 拿 runtime（用于建 DaemonChangeWrite + 在线校验） | D-001 |
| FR-03 | `change_writer/router.py` `/changes/proxy-create` 端点 + `change_writer/service.py` `create_change` 的入参删 `runtime_id`（daemon-client 分支不再要前端传） | D-002 |
| FR-04 | `change/service.py:407` `_enqueue_edit_write`：`runtime_id` 改用 `resolve_runtime_for_writeback` 现算（不再读 `workspace.daemon_runtime_id`） | D-001 |
| FR-05 | `spec_workspace/router.py` `sync_manual_spec_workspace`：daemon-client 分流的 `runtime_id` 改用 `resolve_runtime_for_writeback` 现算（不再读 `binding.runtime_id` / `ws.daemon_runtime_id`，二者新链路均 NULL）；分流条件改基于 `path_source == "daemon-client"` 而非 `runtime_id is not None` | D-001 |
| FR-06 | `daemon/runtime/service.py:674,696` runtime 删除 RESTRICT 查询：从 `col(Workspace.daemon_runtime_id) == runtime_id` 改为查 `daemon_task_leases.runtime_id` + `daemon_change_writes.runtime_id`（D-003 保留处，新链路写回/派发现算后这些列有真实值） | D-003 |
| FR-07 | 前端 `create-change/page.tsx` + `lib/changes.ts` `proxyCreateChange`：删 `runtime_id` 参数；`api-types.ts` OpenAPI 重生成 | D-002 |

## 验收标准（AC）

- **AC-01**：daemon-client workspace（`daemon_runtime_id=NULL` + member binding 行）调
  `POST /changes/proxy-create`（不传 runtime_id）建变更成功，落 DaemonChangeWrite 行
  （runtime_id = 现算值），不再返回 `DAEMON_CLIENT_NO_SESSION`。
- **AC-02**：daemon-client workspace 写变更文件（`_enqueue_edit_write`）成功落
  DaemonChangeWrite 行，不再抛 `ChangeDocNotFound "未绑定 daemon runtime"`。
- **AC-03**：daemon-client workspace `POST /spec-workspace/sync-manual` 走 outbox
  分支返回 `{"status":"pending","task_id":...}`，不再错走 server-local 失败。
- **AC-04**：删除一个仍有 `daemon_task_leases` 或 `daemon_change_writes` 引用的
  runtime → RESTRICT 阻止（行为正确）；删除无引用的 runtime → 成功。
- **AC-05**：`workspace.default_agent=None` 或 daemon 无对应 provider 的 online
  runtime → 写回操作抛 `DaemonClientNoActiveSession`（AppError，HTTP 400，
  code=DAEMON_CLIENT_NO_SESSION，details.reason 区分 + 带 enabled providers 列表），
  不偷偷 fallback 到其他 provider。
- **AC-06**：现有 server-local 流程 + legacy fixture（非空 `daemon_runtime_id`）
  测试全部通过，零回归。
- **AC-07**：前端 daemon-client workspace 建变更页（create-change page）不传
  runtime_id 仍能成功建变更；E2E（page test）通过。
- **AC-08**：binding 行 `runtime_id` 列保持不写（`upsert_my_binding` 不动），D-004
  语义不变。

## 非目标

- 不改 `DaemonChangeWrite` 表结构（runtime_id NOT NULL 保留，D-003）。
- 不改 daemon 端轮询协议（仍按 runtime_id，`GET /runtimes/{rid}/pending-change-writes`）。
- 不改 `daemon_task_leases` 流程（派发写侧已由 daemon-entity-binding 修好）。
- 不做历史 binding 行 runtime_id 回填（D-007 重置；新链路不读 binding.runtime_id）。
- 不动 spec_workspace/import（ql-20260704-002 已修）。
- 不重构整个 change-writer 模块（仅修 binding 解析这一层）。
