---
id: task-02
title: 新增 migration 改主键（batch_alter_table + 回填 id）
goal: platform_change_progress 主键从 change_name 改为 id，现有行回填 id 保留
implementation: |
  1. 新 migration 文件（<时间戳>_platform_change_progress_id_pk.py），down_revision='20260811150000'
  2. batch_alter_table（SQLite 不支持 op.drop_constraint PK/create_primary_key，copy-and-move 重建；precedent 20260811104500_agent_profile_llm_provider.py）
  3. add id 列 nullable → op.get_bind 回填 uuid4（现有行）→ NOT NULL → id 设主键
  4. 保留 (workspace_id, change_name) 复合唯一约束
acceptance:
  - alembic upgrade 成功（PG 生产 + SQLite 测试库双验）
  - 现有行 id 回填（非空）
  - change_name 不再是主键，id 是主键
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
  - alembic upgrade head 不报错（PG/SQLite）
constraints:
  - batch_alter_table 必须（SQLite PK drop 限制，R-01）
  - down_revision 显式 20260811150000
  - 现有行回填 id 保留（D-003）
  - 不改数据内容（仅补 id）
depends_on: [task-01]
allowed_paths:
  - backend/migrations/versions/
provides:
  - contract: migration_id_pk
    fields: [id_pk]
    desc: platform_change_progress 主键迁移到 id，现有行回填
expects_from:
  - contract: platform_change_progress_id_pk
    provider: task-01
    fields: [id]
related_tests: []
---

# task-02: 新增 migration 改主键（batch_alter_table + 回填 id）

> change: `2026-08-13-fix-platform-progress-pk` · Wave 2 · 依赖 task-01
> 依据：plan.md Wave 2 / task-02 行；design.md §6 文件变更清单（新增 migration 行）、§9 兼容策略（brownfield）、R-01；决策 D-003；需求 FR-01/FR-02/FR-04。

## 背景

`platform_change_progress` 表当前以 `change_name` 单主键（`20260810150000_create_platform_change_progress.py`），
2026-08-11 的 `20260811150000_platform_sync_workspace.py` 又加 `workspace_id` 列 + `(workspace_id, change_name)`
复合唯一约束（`uq_platform_change_progress_workspace_change`）。本次 migration 将主键从 `change_name` 迁移到
独立 `id` UUID，配合 task-01 的 model 改动（`PlatformChangeProgressORM` 加 `id` 主键 + `change_name` 去主键）
落地 design §5/§8 的目标态，消除跨 workspace 重名冲突与 NULL 历史行挡道（design §1 两个缺陷）。

## 迁移后目标结构（design §8）

- `id`：UUID **主键**（新增，NOT NULL，现有行 uuid4 回填）
- `workspace_id`：`uuid.UUID | None`，FK workspaces CASCADE（可空，保留 NULL 过渡行）
- `change_name`：String 普通列（**去主键**）
- `latest_progress` / `last_pushed_at` / `last_pusher` / `updated_at`：不变
- 唯一约束 `(workspace_id, change_name)`：**保留**（PG 对 NULL 不参与唯一性 → 跨 workspace 同名、NULL 行与 workspace 行共存）

## 实现要点

1. 新文件 `backend/migrations/versions/<时间戳>_platform_change_progress_id_pk.py`
2. `down_revision = "20260811150000"`（execute 前先 `alembic heads` 实测当前 head；2026-08-13 15:58 实测唯一 head 即 `20260811150000`。
   仓库历史上多次出现 merge-head migration（如 `4d9236aa3abb_merge_heads.py`、`dceb0c45ab3e_merge.py`），多 agent 并发可能再引入新 head——
   若执行时 `alembic heads` 出现多个 head，先补 merge migration 收敛，再挂本 migration）
3. **必须 `op.batch_alter_table`**：SQLite 不支持直接 `op.drop_constraint(type_="primary")`（raise）与 `op.create_primary_key`（静默跳过），
   需 copy-and-move 重建表；precedent `20260811104500_agent_profile_llm_provider.py`。PG 生产 batch 为 no-op wrapper 直接 ALTER，dialect 无关对齐。
4. **回填顺序**（D-003，现有 10 行 8 NULL + 2 workspace 不丢）：先 `op.add_column` 加 `id`（nullable）→ `op.get_bind()` 逐行
   `UPDATE platform_change_progress SET id = :uuid`（uuid4）→ batch 内 `alter_column id` NOT NULL + `create_primary_key`。
   **注意 SQLite 逐行 UPDATE 回填要在 batch recreate 之前执行**，否则新表 copy 遇 NOT NULL 列无值会失败。
5. batch recreate 后需**重建复合唯一约束** `uq_platform_change_progress_workspace_change`（SQLite copy-and-move 随旧表丢弃约束，必须在新表上重建）。
6. 不改数据内容（仅补 id，D-003），不改端点/schema（D-004，无 gen:types）。

## 验收（对应 frontmatter acceptance）

- `alembic upgrade head` 在 PG 生产 / SQLite 测试库均不报错（design R-01 双验）
- 现有行 id 全部回填非空（uuid4）
- `change_name` 不再是主键、`id` 是主键；`(workspace_id, change_name)` 复合唯一仍生效

## 参考

- plan.md：Wave 2 task-02 行；design.md：§6 新增 migration 行、§8 数据模型、§9 兼容策略、R-01；decisions.md：D-003
- migration 写法参考：`20260811104500_agent_profile_llm_provider.py`（batch_alter_table precedent）、
  `20260811150000_platform_sync_workspace.py`（建表/复合唯一约束名与上下文）、`20260810150000_create_platform_change_progress.py`（原表结构）
