---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-13
title: 后端测试 — placement 回退 / provider 解析优先级 / 三入口透传 / API schema
priority: P0
estimated_hours: 3
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: [task-15]
allowed_paths:
  - backend/app/modules/placement/tests/test_provider_fallback.py
  - backend/app/modules/agent/tests/test_provider_resolution.py
  - backend/app/modules/workspace/tests/test_default_agent_api.py
  - backend/app/modules/agent/tests/test_three_entries_provider.py
---

# task-13: 后端测试 — placement 回退 / provider 解析优先级 / 三入口透传 / API schema

## 上下文
覆盖 FR-01~FR-06 的后端契约测试。这是 execute 阶段 task-01~07 的验收网。Pytest 模块级测试策略（local.yaml `test_strategy: module`）。

## 修改文件（必填，测试文件，TDD 中与实现同步或先行）
- `backend/app/modules/placement/tests/test_provider_fallback.py`（新增）
- `backend/app/modules/agent/tests/test_provider_resolution.py`（新增）
- `backend/app/modules/workspace/tests/test_default_agent_api.py`（新增）
- `backend/app/modules/agent/tests/test_three_entries_provider.py`（新增）

## 实现要求（覆盖矩阵）

### A. `test_provider_fallback.py`（FR-03，task-02）
1. `_get_online_runtime(provider="claude")`，claude 在线 → 返回 claude runtime。
2. `_get_online_runtime(provider="claude")`，claude 离线，codex 在线 → 回退 codex + `log.warning("placement_provider_fallback", wanted="claude", actual="codex")`（用 caplog 或 mock log）。
3. `_get_online_runtime(provider="claude")`，全部离线 → 抛原异常（无在线可回退）。
4. `_get_online_runtime(provider=None)` → 按 ORDER BY last_heartbeat（不回退逻辑介入）。

### B. `test_provider_resolution.py`（FR-02，task-03）
1. `start_run(provider="codex")`，workspace.default_agent="claude" → resolved="codex"（显式优先）。
2. `start_run(provider=None)`，workspace.default_agent="claude" → resolved="claude"。
3. `start_run(provider=None)`，workspace.default_agent=None → resolved=None。
4. `start_stage_dispatch` / `start_scan_dispatch` 各一组同样三态测试（验证三入口一致）。
5. resolved provider 透传到 `dispatch_to_daemon(provider=...)`（mock daemon 调用，断言收到）。

### C. `test_default_agent_api.py`（FR-01，task-01/04）
1. POST/PATCH workspace 设 default_agent="claude" → GET 返回 default_agent="claude"。
2. PATCH `{default_agent: null}` → GET 返回 null（显式清空）。
3. PATCH 不带 default_agent 字段 → 既保值不变（exclude_unset）。
4. 迁移可重入：`alembic upgrade head` 后 `default_agent` 列存在（schema 反射 / 直接 SQL 断言）。

### D. `test_three_entries_provider.py`（FR-04/05/06，task-05/06/07）
1. POST create_agent_run body `{"provider":"codex"}` → service 收到 provider=codex。
2. POST dispatch body `{"provider":"codex"}` → dispatch→start_stage_dispatch 收到 codex。
3. POST dispatch 空 body → provider=None（兜底，且不 422）。
4. POST scan-generate body `{"provider":"claude"}` → scan_generate→start_scan_dispatch 收到 claude。
5. 自动调度（dispatch_next_step）不传 provider → start_stage_dispatch 收到 None（内部走 default_agent）。

## 接口定义（代码类任务必填）
均为 pytest 函数测试，断言 service/调用链/provider 解析结果。用 mock daemon 调用（避免真起 daemon）。

## 边界处理（必填）
- **mock daemon**：所有 dispatch_to_daemon 调用 mock 掉，断言传参，不起真 daemon。
- **runtime 在线/离线状态**：用 fixture 构造 runtime 记录（status online/offline）。
- **workspace.default_agent**：用 fixture 构造 workspace 记录。
- **DB 隔离**：每个测试独立 session/事务（既有 conftest 模式）。
- **迁移测试**：单独测试类，确认 upgrade 后列存在。
- **覆盖率门槛**：local.yaml `--cov-fail-under=60`，新增模块需达标。

## 非目标（本任务不做的事）
- 不写前端测试（task-14）。
- 不做端到端多 provider（task-15）。
- 不改实现（task-01~07 已实现）——本任务是验收网。

## 参考
- 既有 placement/agent/workspace/change 测试 conftest（DB session / mock daemon 模式）。
- FR-01~FR-06（requirements.md）。
- task-01~07 的验收标准表。

## TDD 步骤
1. 本任务与 task-01~07 同期或紧跟编写（TDD 先行可更早）。
2. 每个 FR 至少 1 个测试，覆盖正常 + 边界。
3. `cd backend && uv run pytest -q app/modules/placement/tests/test_provider_fallback.py app/modules/agent/tests/test_provider_resolution.py app/modules/workspace/tests/test_default_agent_api.py app/modules/agent/tests/test_three_entries_provider.py` 全绿。
4. `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` 达标。
5. 回归既有测试全绿。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | test_provider_fallback | FR-03 四种场景全绿 |
| AC-02 | test_provider_resolution | FR-02 三入口×三态全绿 |
| AC-03 | test_default_agent_api | FR-01 设/清/保留 + 迁移列存在 |
| AC-04 | test_three_entries_provider | FR-04/05/06 三入口透传 + 自动调度兜底 |
| AC-05 | 全量 pytest --cov-fail-under=60 | 通过 |
| AC-06 | 既有测试无回归 | 全绿 |
