---
author: qinyi
created_at: 2026-08-13 15:58:00
plan_level: light
---

# 实现计划（Plan）— platform_change_progress 主键缺陷修复

> change: `2026-08-13-fix-platform-progress-pk`
> 设计依据：design.md §5/§6/§8/§9；需求：requirements.md FR-01~05；决策：decisions.md D-001~D-005。

## Wave 分组

### Wave 1（model 数据层，无依赖）
- [x] task-01: model.py `PlatformChangeProgressORM` 加 `id` UUID 主键（`Column(Uuid, primary_key=True, default=uuid.uuid4)`）+ `change_name` 去 `primary_key=True` 降普通列（保留 `UniqueConstraint("workspace_id", "change_name")`）

### Wave 2（migration，依赖 task-01）
- [x] task-02: 新增 migration——`batch_alter_table`（SQLite 不支持 PK drop/create，precedent `20260811104500_agent_profile_llm_provider.py`）：add `id` 列（nullable→`op.get_bind` 回填 uuid4→NOT NULL）+ drop change_name PK + id 设主键；保留复合唯一约束。PG + SQLite 双验

### Wave 3（service 适配，依赖 task-02）
- [x] task-03: service.py `upsert_progress` INSERT 分支加 `id=uuid.uuid4()`；`_find_row` 复合键 + IntegrityError 回退逻辑适配（撞复合唯一而非 change_name PK）

### Wave 4（测试 + 文档，依赖 task-03；可并行）
- [x] task-04: 测试——跨 workspace 同名各占一行（FR-01）/ NULL 行与 workspace 行共存（FR-02）/ 同 workspace 并发冲突回退（FR-05）/ migration 后旧数据 id 回填（FR-04）
- [x] task-05: `__init__.py` docstring 更新（change_name 全局唯一 PK → id 主键 + 复合唯一）+ backend 模块文档 platform_sync.md 更新

## 全局验收标准

- [ ] model.py id 主键 + change_name 去主键，测试库 create_all 建表成功（6 构造点 default 免除补 id）
- [ ] migration `batch_alter_table` 改主键成功 + 现有行 id 回填，PG/SQLite 双验（alembic upgrade 不报错）
- [ ] 跨 workspace 同名进度各占一行、NULL 行共存、并发冲突回退——测试全绿
- [ ] `cd backend && uv run pytest app/modules/platform_sync -q --no-cov` + `app/modules/change` 回归全绿
- [ ] 端点/body/schema 不变，无 gen:types（D-004）；旧客户端无感

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 加 id 主键 + change_name 去主键 + 复合唯一 | task-01/02 | model.py + migration |
| D-002 保留复合唯一 | task-01 | model.py UniqueConstraint |
| D-003 NULL 行保留 + 回填 id | task-02/04 | migration 回填 + 测试 |
| D-004 无 gen:types | —（非目标） | 端点 schema 不变 |
| D-005 service INSERT 加 id + 回退不变 | task-03/04 | service.py + 并发测试 |

| FR | 覆盖任务 |
|---|---|
| FR-01 跨 workspace 重名共存 | task-02/04 |
| FR-02 NULL 行共存 | task-02/04 |
| FR-03 零 API 变更 | —（非目标 NG-01） |
| FR-04 现有数据保留 | task-02/04 |
| FR-05 并发回退 | task-03/04 |
