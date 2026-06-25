---
id: task-09
title: 运行并修正 backend 模块级测试与格式检查
priority: P0
estimated_hours: 3
depends_on: [task-03, task-04, task-05]
blocks: [task-11]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/**
  - backend/app/modules/workspace/**
  - "backend/migrations/versions/*add_resource_display_alias*"
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-09.md
author: qinyi
created_at: "2026-06-25 18:10:00"
---

# task-09: 运行并修正 backend 模块级测试与格式检查

> 本 task 在 task-03/04/05 实现落地后，集中运行 backend 模块级测试与静态检查，定位并修正回归。优先 daemon/workspace 模块（`local.yaml` `test_strategy=module`）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 可能修改 | `backend/app/modules/daemon/**`、`backend/app/modules/workspace/**` | 仅修正本变更引入、由测试或 mypy/ruff 暴露的真实缺陷；不扩大范围。 |
| 可能修改 | `backend/migrations/versions/*add_resource_display_alias*` | 仅当迁移链或字段规格与 ORM/测试不一致时修正（参考 memory 迁移链断裂模式）。 |
| 修改 | 本 task 文件 | 记录运行结果、失败原因与修正点。 |

> 若 task-01 的测试失败原因最终定位为测试本身夹具错误（非生产代码缺陷），可在 task-01 的 allowed_paths 内回退修正测试；本 task 不代写新测试用例。

## 覆盖来源

| 来源 | 本 task 落点 |
|---|---|
| FR-01/FR-02 | daemon/workspace 平台管理员全局与普通账号隔离测试通过。 |
| FR-03 | `display_alias` 迁移、ORM、PATCH set/clear 测试通过。 |
| FR-04 | `q/type/status/limit/offset` 筛选分页与 `/runtimes/page` 路由顺序测试通过。 |
| FR-06 | 旧 `GET /api/daemon/runtimes` 数组兼容与 `GET /api/workspaces` `{items,total}` 兼容测试通过。 |
| D-001/D-003 | 权限边界测试（`user_id` 仅平台管理员、跨 owner 管理）通过。 |
| D-005 | `/runtimes/page` 不被 `{runtime_id}` 抢占的回归测试通过。 |
| D-006 | owner 嵌套 DTO 形态测试通过。 |

## 实现要求

1. 读取 `local.yaml` 确认后端命令（`cd backend && uv run pytest`、`cd backend && uv run ruff check .`）。
2. 优先跑本变更新增/相关测试：
   ```bash
   cd backend && uv run pytest \
     app/modules/daemon/tests/test_runtime_admin_management.py \
     app/modules/workspace/tests/test_workspace_admin_management.py -v
   ```
   再扩展到 daemon/workspace 模块全量：
   ```bash
   cd backend && uv run pytest app/modules/daemon app/modules/workspace -v
   ```
3. 跑迁移链一致性验证（参考 memory `migration-chain-fragmentation-pattern`）：
   ```bash
   cd backend && uv run alembic heads          # 必须单一 head
   cd backend && uv run alembic upgrade head   # 升级成功
   cd backend && uv run alembic downgrade -1   # 仅删两个 display_alias 列
   cd backend && uv run alembic upgrade head   # 恢复
   ```
   若出现多 head 或 down_revision 断链，停止并按 memory 修复（唯一 revision id + down 接真实 head），不写 merge migration 掩盖。
4. 跑静态检查：
   ```bash
   cd backend && uv run ruff check app/modules/daemon app/modules/workspace migrations/versions
   cd backend && uv run mypy app/modules/daemon app/modules/workspace
   ```
   仅修正本变更引入的问题；既有无关告警不在本 task 扩大处理。
5. 对每个失败用例分类记录：
   - 生产代码缺陷 → 在本 task allowed_paths 内修正 daemon/workspace 实现。
   - 测试夹具/写法错误 → 回 task-01 修正测试（不在本 task 改测试逻辑）。
   - SQLite vs PG 方言差异（参考 memory `backend-test-sqlite-vs-pg`）→ 用方言分支或基于行数/时间的断言，不绑死 SQL 函数名。
6. 重点关注 dialect 相关风险：`ilike` 在 SQLite 的兼容、`outerjoin` + `func.count()` total 在 SQLite 的行为、`date_trunc` 等 PG 方言不要出现在本变更查询中。
7. 跑完后在 task 文件记录：命令、通过/失败数、关键修正点、残余风险（如某项因环境无法运行）。

## 接口定义

本 task 无新接口，只运行验证命令。命令清单见「实现要求」。

## 边界处理

1. **测试失败归因**：先区分生产缺陷 vs 测试写法错误；生产缺陷在本 task 修，测试错误回 task-01 修。
2. **不修改测试逻辑通过**：遵守 CLAUDE.md 规则 8——非测试本身有误不改测试凑过。
3. **多 head/断链**：停止，按 memory 修复 revision/down_revision，不写 merge migration。
4. **SQLite 方言**：`ilike`/count/分页在 SQLite 与 PG 行为差异，用 dialect 分支或宽松断言。
5. **既有回归**：本变更外的旧用例若因本变更破坏，必须修复（如旧 `list_runtimes` 数组端点、workspace 默认列表）；若是无关既有 flaky，记录但不扩大处理。
6. **环境缺失**：本机无 sqlite3 CLI 时，迁移验证用 `uv run alembic` + pytest 内存库，不绕过（参考 memory sillyspec 收口相关）。
7. **范围控制**：修正只落在 daemon/workspace 模块和本变更迁移；不碰 auth/admin/agent 等无关模块的生产代码。
8. **不静默吞异常**：生产代码修正仍遵循 AppError/FastAPI 异常机制。

## 非目标

- 不新增测试用例（由 task-01 提供）。
- 不实现新功能（由 task-03/04/05 提供）。
- 不修改前端、daemon 客户端（sillyhub-daemon）、无关后端模块。
- 不跑全量 backend 套件（`test_strategy=module`），除非模块测试暴露跨模块破坏。
- 不为历史数据回填 `display_alias`。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-01.md`（测试蓝图与失败归因约定）。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-03.md`、`task-04.md`、`task-05.md`（实现契约）。
- `.sillyspec/local.yaml`（backend 命令、`test_strategy=module`）。
- `.sillyspec/docs/backend/scan/CONVENTIONS.md`、`ARCHITECTURE.md`、`modules/migrations.md`、`modules/daemon.md`、`modules/workspace.md`。
- memory：迁移链断裂模式、backend 测试 SQLite vs PG。

## TDD 步骤

1. 跑 task-01 指定的两个新测试文件，记录结果。
2. 跑 daemon/workspace 模块全量，定位回归。
3. 跑 alembic 迁移链验证。
4. 跑 ruff/mypy。
5. 按归因分类修正（生产缺陷本 task 修，测试错误回 task-01）。
6. 重跑直到目标测试与模块测试全绿；残余风险记录。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `pytest test_runtime_admin_management.py test_workspace_admin_management.py` | task-01 全部测试通过（权限/分页/别名/路由顺序/兼容）。 |
| AC-02 | `pytest app/modules/daemon app/modules/workspace` | 模块测试全绿，无本变更引入的回归。 |
| AC-03 | `alembic heads` | 单一 head。 |
| AC-04 | `alembic upgrade/downgrade` | 升级成功，downgrade 仅删两个 `display_alias` 列，链无断头。 |
| AC-05 | `ruff check` + `mypy` | 本变更文件无新增 lint/type 错误。 |
| AC-06 | 旧端点兼容回归 | 旧 `GET /api/daemon/runtimes` 数组、`GET /api/workspaces` `{items,total}` 测试通过。 |
| AC-07 | 失败归因记录 | 每个曾失败用例的根因与修正点写入 task 文件；残余风险列明。 |
