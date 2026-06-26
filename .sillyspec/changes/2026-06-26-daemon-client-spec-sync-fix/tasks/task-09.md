---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-08]
blocks: [task-10, task-11]
requirement_ids: [FR-08]
decision_ids: [D-004@v1]
---

# task-09 — backend pending-change-writes + claim/complete 回执端点

## goal
backend 端 daemon 轮询/回执三端点（覆盖 FR-08），复用 pending-leases 风格 + lease claim/complete 模式：daemon 轮询到 pending change-write → claim（token 轮转）→ 本地写后回执 → complete 落 done；超时 claimed 行由 gc 置 failed。

## allowed_paths
- backend/app/modules/daemon/change_write_router.py（新增）
- backend/app/modules/daemon/router.py
- backend/app/modules/daemon/schema.py

## context
- design §5.3 Phase 3 架构约束：daemon 不暴露 HTTP，change-write 经 lease-polling 机制。
- design §7.5 契约表：write_change 下发 pending→claimed；回执 claimed→done。
- design NFR-03：pending 超时 60s → failed，前端可重试。
- task-08 产出 `daemon_change_writes` 表（id/workspace_id/runtime_id/change_key/files/status/claim_token/created_at/completed_at/error）。
- 现有风格：router.py:1392-1432 `pending-leases`（raw SQL + mapping 返回 list[dict]）；鉴权 `get_current_principal`（daemon `X-API-Key` 或 Bearer）。
- lease 模式：`lease/service.py` claim 走 SELECT...FOR UPDATE SKIP LOCKED 抢任务 + 生成 claim_token + status pending→claimed；complete 校验 claim_token + claimed→done。

## implementation
1. 新增 `change_write_router.py`（或并入 router.py 亦可），三端点全部走 `Depends(get_current_principal)` 复用 runtime 鉴权，不新发明 auth。
2. `GET /api/daemon/runtimes/{rid}/pending-change-writes`：对齐 `pending-leases`，raw SQL 选 `status='pending' AND runtime_id=:rid ORDER BY created_at`，mapping 返回 `[{task_id, change_key, workspace_id, files, created_at}]`（files 即 daemon 本地待写清单）。
3. `POST /api/daemon/change-writes/{id}/claim`：事务内 `SELECT ... FOR UPDATE SKIP LOCKED` 抢一行（`status='pending'`）→ 生成 `claim_token`（secrets）→ `status` pending→claimed、`claimed_at=now`→ 返回 `{task_id, claim_token, change_key, files}`。幂等：同 id 已 claimed/done/failed 拒（返回 409/404），并发多 daemon 抢同一行靠 SKIP LOCKED 互斥。
4. `POST /api/daemon/change-writes/{id}/complete`：body `{claim_token, ok, files[]?, error?}`；校验 claim_token 匹配 + `status='claimed'` → `ok=true` 落 `status=done, completed_at=now`（files 记录回执路径），`ok=false` 落 `status=failed, error=...`。token/状态不符 → 409。
5. 超时 gc（NFR-03，60s）：claimed 行 `claimed_at < now-60s` → `status=failed, error='claim timeout'`。复用 `lease/service.py` `gc_expired_leases` 批处理模式（或单独 `_gc_expired_change_writes`），由既有后台 sweep 调度或 pending 端点顺带触发。
6. schema.py：补 `ChangeWriteClaimResponse` / `ChangeWriteCompleteRequest`（Pydantic）。

## acceptance
- daemon 轮询 `pending-change-writes` 能拿到 task-08 插入的 pending 行。
- claim 幂等：同 id 二次 claim 拒；并发两 daemon claim 同一行仅一方得手。
- complete 校验 claim_token + ok 落 done / 失败落 failed；token 错或状态不符 → 409。
- claimed 行超 60s 被 gc 置 failed。

## verify
- `cd backend && uv run pytest`（端点单测 + claim 并发测 + 超时 gc 测）。
- `cd backend && uv run ruff check`。
- 注意 SQLite 测库无 `FOR UPDATE SKIP LOCKED`：dialect 分支（PG 走 SKIP LOCKED，SQLite 退化为先 SELECT 后事务内状态校验，断言不绑死 SQL 函数名）。

## constraints
- 复用 `get_current_principal` runtime 鉴权，不新增 auth 中间件。
- claim_token 轮转对齐 lease 模式（`lease/service.py` _get_lease_and_verify_token）。
- 纯任务队列，不启 agent（与 batch agent-run lease 区分；本端点只管状态机 + 文件清单回执，落 Change 行在 task-10 proxy 侧）。
- Windows/Linux/macOS 兼容（无平台特定路径）。

## 执行记录（2026-06-26）

- 提交：`d8396f62 feat(daemon): change-write 任务队列三端点 + claim/complete + 60s 超时 gc (task-09)`。
- 实现：新增 `change_write_router.py`，挂载 `pending-change-writes` / `claim` / `complete` 三端点；补 `ChangeWrite*` schema；新增 `test_change_write_router.py` 覆盖 pending、claim 并发、complete token 校验、失败回执、60s 超时 gc。
- 说明：task-08 建表缺少 `claimed_at`，task-09 为实现 NFR-03 超时 gc 同步补了 `DaemonChangeWrite.claimed_at` 与 migration 列。
- 验证：目标 backend pytest 集合 `74 passed`；`uv run ruff check .`、`uv run ruff format --check .`、`uv run mypy app` 通过。
- 遗留：无代码遗留；真实 daemon 轮询链路留给 task-14 端到端验证。
