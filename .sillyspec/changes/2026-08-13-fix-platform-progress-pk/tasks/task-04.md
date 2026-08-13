---
id: task-04
title: 测试（跨 workspace 重名 / NULL 共存 / 并发回退 / 迁移回填）
goal: 覆盖新主键语义，拦住回归
implementation: |
  1. platform_sync/tests：跨 workspace 同名 upsert 各占一行（(A,foo) 与 (B,foo) 共存互不覆盖）
  2. NULL 行 + workspace 行共存（shk_live_ 过渡行不挡带 workspace 行）
  3. 同 workspace 并发双发冲突回退（IntegrityError → UPDATE，非 500）
  4. migration 回填测试（仿 test_daemon_started_at：MigrationContext+Operations 驱动 upgrade()，验证旧数据 id 回填）
acceptance:
  - 4 类用例全绿（FR-01/02/04/05）
  - 既有 platform_sync 测试不回归
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
constraints:
  - 真实断言（不 mock 被测方法）
  - 跨 workspace 重名是修复目标，必须覆盖
  - 迁移回填测试仿 test_daemon_started_at 模式
depends_on: [task-03]
allowed_paths:
  - backend/app/modules/platform_sync/tests/
  - backend/tests/
provides:
  - contract: pk_fix_tests_green
    desc: 新主键语义测试全绿
expects_from:
  - contract: upsert_id
    provider: task-03
    fields: [id]
  - contract: migration_id_pk
    provider: task-02
    fields: [id_pk]
related_tests:
  - backend/app/modules/platform_sync/tests/test_router.py
---
# Task-04 — 测试（跨 workspace 重名 / NULL 共存 / 并发回退 / 迁移回填）

测试任务（plan.md Wave 4，依赖 task-03；与 task-05 可并行）。为 task-01/02/03 的新主键语义补四类用例：跨 workspace 同名各占一行（FR-01）、NULL 行与 workspace 行共存（FR-02）、同 workspace 并发冲突回退（FR-05）、migration 后旧数据 id 回填（FR-04）。全部落在 `backend/app/modules/platform_sync/tests/`（allowed_paths），用根 conftest 的 `db_session` fixture，真实断言、不 mock 被测方法（constraints）。

现有测试参考（只读）：
- `test_router.py::test_apply_catches_integrity_error_falls_back_to_update`——并发回退既有模式（catch IntegrityError → rollback → 重查 UPDATE，ql-20260811-005-6881）
- `test_workspace_router.py::_make_workspace`——建 Workspace 行模式（id/name/slug/root_path/status）
- `backend/app/modules/daemon/tests/test_daemon_started_at.py`——migration 单测模式（`importlib` 动态加载 migration + `MigrationContext` + `Operations.context` 驱动 `upgrade()`，不依赖 alembic 树 / env.py）

## 1. 跨 workspace 同名 upsert 各占一行（FR-01 / D-001 / R-04）

修复目标直接验证（R-04 / design §1）：workspace A 与 B 同名 change 各占一行、互不覆盖。改前第二个 workspace 的 INSERT 撞 `change_name` 单主键（model.py:69 现状）→ IntegrityError → 回退再查仍无 → **500**（design §1 缺陷 1）。

用例（service 层直调 `upsert_progress`）：
1. 用 `test_workspace_router.py::_make_workspace` 模式建两个 Workspace 行 `ws_a` / `ws_b`。
2. `PlatformSyncService(db_session)` 分别对 `(ws_a.id, "foo")` 与 `(ws_b.id, "foo")` 调 `upsert_progress(workspace_id, "foo", body, None, T2, "alice")`（`base_ts=None` → 无条件接受分支，service.py:76-78）——两次均不抛错、非 500。
3. 断言：`select` 按复合键 `(workspace_id, change_name)` 分别取 `(ws_a.id, "foo")` 与 `(ws_b.id, "foo")` **两行都非 None**，且各自 `latest_progress` 对应各自 body（互不覆盖）；即复合唯一约束下跨 workspace 重名合法（design §8「change_name 从全表唯一 → 同 workspace 内唯一」）。

改前此用例红（第二个 INSERT 撞 PK 500），改后绿——是 task-01/02/03 的验收证据。

## 2. NULL 行 + workspace 行共存（FR-02 / D-003 / design §9）

`shk_live_` 过渡期全局上行产生 `workspace_id=NULL` 行（design §2 G2 / §9），改前占用 `change_name` 单主键，后续带 workspace 的同名行**插不进去**（design §1 缺陷 2，2026-08-13 演示用 `UPDATE` 改绑 NULL 行绕过）。修复后复合唯一约束对 NULL 不参与唯一性 → 两者共存（design §5）。

用例（service 层直调）：
1. 先 `upsert_progress(None, "foo", legacy_body, None, T1, "legacy")` 建 NULL 过渡行（shk_live_ 过渡路径）。
2. 再 `upsert_progress(ws_a.id, "foo", ws_body, None, T2, "alice")` 建带 workspace 行——改前 500，改后不抛。
3. 断言：`_find_row(None, "foo")` 与 `_find_row(ws_a.id, "foo")` 均返回行、`latest_progress` 各是各自 body；`list_lightweight(None)` 全局聚合仍命中 NULL 行、`list_lightweight(ws_a.id)` 命中 workspace 行——列表投影按复合键各命中各行（FR-02）。

## 3. 同 workspace 并发双发冲突回退（FR-05 / D-005 / R-03）

`test_router.py::test_apply_catches_integrity_error_falls_back_to_update` 已覆盖 NULL workspace 路径（ql-20260811-005-6881）；本用例补**同 workspace（非 NULL）**并发回退，验证撞的是复合唯一 `uq_platform_change_progress_workspace_change` 而非 change_name PK，回退逻辑不变（service.py:126-134：catch IntegrityError → rollback → 重查 UPDATE）。

用例（仿既有模式，`workspace_id` 换成 `ws_a.id`）：
1. 建 `ws_a` + 预插行（= 并发对手已抢先 INSERT 建行）：`PlatformChangeProgressORM(workspace_id=ws_a.id, change_name="race-y", latest_progress={"old": True}, last_pushed_at=T1, last_pusher="rival")`，commit。
2. `svc._apply(ws_a.id, None, "race-y", new_body, T2, "alice")`（`row=None` 模拟并发窗口：`upsert_progress` 的 `_find_row` 在对手 commit 前返回 None）→ 断言**不抛**（非 500）。
3. 断言：复合键重查 `(ws_a.id, "race-y")` 行存在且 `latest_progress == new_body`、`last_pusher == "alice"`、`last_pushed_at == T2`（已回退 UPDATE 覆盖，test_router.py:333-347 模式）。
4. 主键生效断言：该行 `id` 非 None（`default=uuid.uuid4`，task-01；同 workspace 并发双发两请求都想 INSERT 同一复合键，落到 UPDATE 后 id 保持对手行 id，不新造）。

## 4. migration 回填测试（FR-04 / D-003 / R-01）

仿 `test_daemon_started_at.py`：`importlib.util.spec_from_file_location` 动态加载 task-02 产出的 migration 文件（`backend/migrations/versions/<ts>_platform_change_progress_id_pk.py`；建议按 `*_platform_change_progress_id_pk.py` glob 匹配，避免硬编码时间戳），绑定临时 SQLite 连接的 `MigrationContext.configure(conn, opts={})` + `Operations.context(mc)` 驱动 `upgrade()`。

要点：
1. **基线 schema**：建迁移前的旧表——`change_name` 为 `primary_key`（单主键，model.py:69 现状）、`workspace_id`（可空）、`latest_progress` JSON、`last_pushed_at`/`last_pusher` String、`updated_at` DATETIME。`batch_alter_table`（copy-and-move 重建，design §9 R-01）在 SQLite 上按基线表重建即可（仿 `_seed_daemon_instances_table` 最小化建表，列名与旧表对齐）。
2. **旧数据**：插入多行模拟生产 8 NULL + 2 workspace——`workspace_id=NULL` 行（2 行，不同 change_name）+ workspace 行（`ws_a.id`，1 行），各带不同 `latest_progress`。
3. **upgrade 后断言**（FR-04 / D-003）：
   - inspector 列含 `id`；`get_pk_constraint` 主键列 = `["id"]`（change_name 已去主键，task-02）；
   - 旧数据保留：按行查 `id` 均非 None（uuid4 回填，design §8「现有 10 行回填 id 保留」），且每行 `workspace_id` / `change_name` / `latest_progress` 原值不变（不丢进度镜像）；
   - 唯一约束 `uq_platform_change_progress_workspace_change` 存在（`get_unique_constraints`，D-002 保留）。
4. （可选）downgrade 幂等：仿 test_daemon_started_at 可逆性；若 task-02 `downgrade` 只做结构回退不涉及回填，upgrade 单程断言即可，不强行造 downgrade 数据断言。

注意：`MigrationContext.configure(conn, opts={})` 必须传非 None `opts`（空 dict 即可），`SchemaObjects` 取 `opts["target_metadata"]` 时空 dict 安全（test_daemon_started_at.py `_run_with_op` 注释：不传则 opts 为 None → AttributeError）。

## 依据

- plan.md task-04 描述（Wave 4，依赖 task-03）：跨 workspace 同名 / NULL 共存 / 并发回退 / migration 回填 四类测试；覆盖矩阵 FR-01/02/04/05 → task-04。
- design.md §6 文件清单「test_router.py 或新增测试」+ §8 数据模型（id 主键 + 复合唯一）+ §9 兼容（NULL 行共存 / 回填）+ 风险 R-01（migration 回填）/ R-03（并发回退）/ R-04（跨 workspace 重名）。
- requirements.md FR-01（跨 workspace 重名共存）/ FR-02（NULL 行共存）/ FR-04（现有数据保留回填）/ FR-05（并发回退）+ NFR-02（测试覆盖四类）。
