---
author: qinyi
created_at: 2026-07-05 00:41:11
change: 2026-07-05-daemon-client-change-binding-fix
stage: brainstorm
---

# Tasks — daemon-client 写回流程对齐 daemon-entity-binding

> 任务清单（只列名称、文件路径、覆盖 FR/D；实现细节在 plan 阶段展开为 Wave）。

## task-01 — 抽共享 resolve_runtime_for_writeback + placement 查询提取

- **文件**：
  - `backend/app/modules/workspace/member_runtimes/resolver.py`（新增 `resolve_runtime_for_writeback`）
  - `backend/app/modules/workspace/member_runtimes/queries.py`（新增，模块级查询函数）
  - `backend/app/modules/agent/placement.py`（三个查询方法提取为模块级，原方法改为调用）
- **覆盖**：FR-01 / D-001@v1 / D-004@v1
- **要点**：复刻 placement.py:702-749 的 daemon_id+default_agent 解析；NoOnlineDaemonError 内部转译为 DaemonClientNoActiveSession（reason 字段）；placement 现有测试零回归

## task-02 — change_writer proxy-create 删 runtime_id 入参 + 校验改现算

- **文件**：
  - `backend/app/modules/change_writer/proxy.py`（line 168 签名删 runtime_id；line 192 死校验删，改调 resolve_runtime_for_writeback）
  - `backend/app/modules/change_writer/router.py`（line 90 ProxyCreateChangeRequest 删 runtime_id）
  - `backend/app/modules/change_writer/service.py`（line 57 create_change 签名删 runtime_id；line 113-135 分支简化）
- **覆盖**：FR-02 / FR-03 / D-001@v1 / D-002@v1
- **要点**：DaemonChangeWrite(runtime_id=现算值)；二次心跳校验保留防竞态

## task-03 — change/service.py write_file + _enqueue_edit_write 补 user_id + 现算 runtime

- **文件**：
  - `backend/app/modules/change/service.py`（write_file:328 加 user_id；_enqueue_edit_write:384 加 user_id；line 407 改现算）
  - `backend/app/modules/change/router.py`（line 216 write_file 端点传 user.id）
- **覆盖**：FR-04 / D-001@v1
- **要点**：Grill 发现的 user_id 改动链（write_file/router/_enqueue_edit_write 三处）

## task-04 — spec_workspace/router.py sync-manual runtime_id 改现算

- **文件**：`backend/app/modules/spec_workspace/router.py`（line 148-196 sync_manual_spec_workspace）
- **覆盖**：FR-05 / D-001@v1
- **要点**：分流条件改 path_source==daemon-client（不再依赖 runtime_id 非空）；runtime_id 在 daemon-client 分支内现算；保留 MemberBindingResolver 解析 daemon_id+root_path

## task-05 — daemon/runtime/service.py runtime 删除 RESTRICT 改查 lease+change_write

- **文件**：`backend/app/modules/daemon/runtime/service.py`（line 674, 696 两处查询改表）
- **覆盖**：FR-06 / D-003@v1
- **要点**：查 daemon_task_leases.runtime_id + daemon_change_writes.runtime_id；任一命中 → RESTRICT 阻止

## task-06 — 前端 create-change page + lib/changes.ts 删 runtime_id + api-types 重生成

- **文件**：
  - `frontend/src/lib/changes.ts`（line 226 proxyCreateChange 删 runtime_id 入参）
  - `frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx`（line 104 调用删 runtime_id）
  - `frontend/src/lib/api-types.ts`（OpenAPI 重生成）
- **覆盖**：FR-07 / D-002@v1
- **要点**：daemon_id 后端从 binding 拿，前端不需传

## task-07 — 后端测试（新链路覆盖 + 回归）

- **文件**：
  - `backend/app/modules/workspace/member_runtimes/tests/test_resolver.py`（新增 resolve_runtime_for_writeback 各边界）
  - `backend/app/modules/change_writer/tests/test_proxy.py`（daemon_runtime_id=NULL + binding 新链路）
  - `backend/app/modules/change/tests/test_files_router.py`（_enqueue_edit_write 新链路）
  - `backend/app/modules/spec_workspace/tests/test_sync_manual.py`（daemon-client 走 outbox）
  - `backend/app/modules/daemon/runtime/tests/`（runtime 删除 RESTRICT 改查询）
  - `backend/app/modules/agent/tests/test_placement*.py`（查询提取后零回归）
- **覆盖**：AC-01 / AC-02 / AC-03 / AC-04 / AC-05 / AC-06 / AC-08
- **要点**：补 daemon_runtime_id=NULL + member binding fixture（现有 fixture 全用非空 runtime_id 是盲区）

## task-08 — 前端测试

- **文件**：`frontend/src/app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx`
- **覆盖**：AC-07
- **要点**：daemon-client workspace 建变更不传 runtime_id 仍成功；DAEMON_CLIENT_NO_SESSION 错误渲染引导（已有，保留）
