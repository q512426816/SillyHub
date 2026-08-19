---
id: task-02
title: add-description-column-and-migrate-legacy-type
title_zh: migration——description 列新增与存量 type CASE 收编
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/migrations/versions/20260818150000_workspace_role_type.py
  - backend/tests/modules/workspace/test_migration_workspace_role_type.py
provides:
  - contract: Workspace.description 列
    fields: [description]
expects_from:
  task-01:
    - contract: WORKSPACE_TYPE 词表常量
      needs: [WORKSPACE_TYPE_VALUES, YAML_TYPE_NORMALIZE_MAP]
goal: >
  新建 alembic 迁移为 workspaces 表加 description Text 可空列，并对存量非空 type 按映射可收编子集做幂等 CASE 收编 UPDATE，downgrade 删列并注明 type 不回滚（design §5.2/§8）。
implementation:
  - model.py Workspace 补 description 字段——Field(default None, sa_column Column(Text, nullable True))，放置位置对齐组件元数据字段区（component_key 至 default_branch 之间，65-85 行附近）；ORM 元数据变更让 create_all 测试库自动建列，pytest 全量跑前置就绪
  - 新建 migrations/versions/20260818150000_workspace_role_type.py——revision=20260818150000，down_revision=20260817100000（当前唯一 head，merge_quicklog_and_run_sender 已核，多 agent 并行下 execute 时需重跑 ls versions 复核单 head 链）
  - upgrade 两步——op.add_column 加 description TEXT NULL；执行存量收编 UPDATE（design §8 SQL 原文，CASE WHEN 按 YAML_TYPE_NORMALIZE_MAP 可映射子集共 18 条分支 ELSE type END 加 WHERE type IS NOT NULL），用 sa.text 或 op.execute，分支表逐字对照 task-01 的 map（值域 frontend-code/backend-code/fullstack/business-doc/submodule/deploy-ops/design-asset）
  - downgrade——op.drop_column 删 description，docstring 注明 type 收编不可逆（原值已被 CASE 覆盖，design §9 回退路径）
  - 新建 backend/tests/modules/workspace/test_migration_workspace_role_type.py——沿用 test_migration_borrow_shared 的 _load_migration 三段范式：元数据断言（revision/down_revision 链接 20260817100000）加 ORM 元数据断言（Workspace 表含 description 列 nullable）加 SQLite 内存库 replay 建旧形态表跑 upgrade 验收编（插 web 与未知值 legacy 两行，收编后 web 变 frontend-code、未知值原样）与 downgrade
acceptance:
  - 迁移可导入且 down_revision 接 20260817100000 单 head，PG 上 alembic upgrade head 通过（AC-06，PG 链路由 verify 阶段覆盖）
  - ORM 表元数据含 nullable 的 description 列；SQLite replay 证明收编 UPDATE 幂等（跑两遍结果不变）且映射不上原值保留
  - pytest 全量 workspace 模块绿——model 加列后 create_all 路径测试不受影响
verify:
  - cd backend && uv run pytest app/modules/workspace/tests tests/modules/workspace -q
constraints:
  - CASE 分支只收编 YAML_TYPE_NORMALIZE_MAP 的可映射子集，绝不把未知值强改 other（D-003@v1 与 design §9）
  - downgrade 不写反向 CASE——原值不可恢复，注释注明即可
  - revision 号 20260818150000 若撞并行 change 需顺延并在卡内记录实际号
related_tests: []
---
