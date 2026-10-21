---
id: task-08
title: '1b backend: snapshot persistence (side table) + read-model projection + capability gate'
title_zh: '1b backend：快照承载 + 读模型透传 + capability 门控'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-13, FR-14, FR-15, FR-16]
decision_ids: [D-023@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/router/session_insights.py
  - backend/migrations/versions/
  - backend/app/modules/daemon/tests/
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/router/session_insights.py
  - NEW:backend/app/modules/daemon/tests/test_session_file_changes.py
provides:
  - contract: turn-snapshot-read-model
    fields: [fileChanges, fileChangesCapability, timing]
goal: >
  把 daemon 上报的 `TurnFileChangesSnapshot` 与 `TurnTimingSnapshot` 落成可读模型：轮次/会话读模型多带
  `fileChanges` 与 `timing`（无数据为 null）+ 独立 `capability`（"full" | "tool_only"）。老 daemon 不上报时
  必须给 `tool_only`，禁止把「字段缺失」透成「无改动」。
implementation:
  - '首步跑 spike-03：在 aiosqlite 夹具与 PG 上各跑一遍 upgrade/downgrade；不可行则退到 DaemonTaskLease.metadata_ 旁路键（仍不改既有响应形状）'
  - 'backend/app/modules/daemon/model.py：新增侧表 `DaemonRunSnapshot`（`__tablename__="daemon_run_snapshots"`）：run_id（FK agent_runs.id，unique，ondelete CASCADE）、file_changes JSON NULL、timing JSON NULL、collect_ms int NULL、status str(16) NULL、reason str(32) NULL、truncated bool default false、capability str(16) NOT NULL default "tool_only"、daemon_version str(50) NULL；索引仅 run_id 唯一（不改 agent_runs 表）'
  - 'backend/migrations/versions/：生成一条增量迁移（文件名 20261021xxxx_add_daemon_run_snapshots.py），只建表 + 唯一索引；downgrade drop table。禁改既有表'
  - 'backend/app/modules/daemon/schema.py：新增 `TurnFileChange` / `TurnFileChangesSnapshot` / `TurnTimingSnapshot` 的 pydantic 镜像（字段名逐字对齐 design「接口定义」：path/status/added/deleted/binary/attribution/editToolNames/source；runId/baselineHead/collectedAt/collectMs/status/reason/truncated/files/concurrentSessionsHint；timing 为 attempts[]/firstTokenAt/model/tokens）+ `FileChangesCapability` Literal["full","tool_only"]；轮次读模型响应追加 `file_changes: TurnFileChangesSnapshot | None`、`file_changes_capability: FileChangesCapability`、`timing: TurnTimingSnapshot | None`'
  - 'backend/app/modules/daemon/lease/service.py：在轮终态 apply 路径（与 `_upsert_batch_model_usage` 同事务段，:1168-1196 附近）加 `_upsert_run_snapshot(agent_run, payload)`——`(run_id)` 键幂等覆盖写（先按 run_id 删后插，或 PG upsert），异常 best-effort 捕获不拖垮终态；capability 由 payload 是否含快照字段决定（含 → "full"，缺 → "tool_only"），并把 daemon 上报里的 daemon_version 一起存'
  - 'backend/app/modules/daemon/router/session_insights.py：在本文件**另起段落**加轮次读模型投影（不得动 :933-1052 的 model-usage 端点）：按 run 批量查 daemon_run_snapshots（一次 IN 查询，禁 N+1），投影 file_changes / file_changes_capability / timing；无行 → null + "tool_only"'
  - '测试：NEW backend/app/modules/daemon/tests/test_session_file_changes.py——①full 分支序列化（files 全字段 + capability="full"）②tool_only 分支（无行 → null + "tool_only"）③幂等（同一 run_id 连写两次 → 1 行，字段取最后一次）④失败/部分态透传（status="partial" + reason="timeout" + truncated=true 原样出现）⑤投影不引入 N+1（断言查询次数或一次性 IN）'
acceptance:
  - '`uv run alembic upgrade head` 后 `daemon_run_snapshots` 存在；`alembic downgrade -1` 可回退干净'
  - 同上五条测试全绿；断言里 `capability` 两个分支都不为 None，且 `fileChanges=null` 时不得伪造「无改动」占位值
  - '既有 model-usage 4 例不回归（uv run pytest app/modules/daemon/tests/test_session_model_usage.py）'
  - '读模型对多 run 批量查询只发 1 条 snapshot 查询（断言 SQL 次数或 mock 调用次数 ≤1）'
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_file_changes.py app/modules/daemon/tests/test_session_model_usage.py
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
constraints:
  - 字段名逐字对齐 design「接口定义」；三段（daemon DTO / pydantic 镜像 / 前端类型）不得增删字段
  - 不新增 HTTP 端点、不改既有端点响应形状（只加字段）；不写 agent_run_logs、不写 edit_patch 表
  - 幂等键 `(run_id)`；重复上报等价最后一次，禁追加
  - session_insights.py 只许另起段：model-usage 段（:933-1052）一行不改
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_model_usage.py
    reason: 同文件（session_insights.py）新增投影段时若误改既有端点或响应形状，这 4 例必须先红
---
