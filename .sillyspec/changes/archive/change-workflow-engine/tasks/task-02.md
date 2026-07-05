---
id: task-02
title: "DB迁移 — Alembic迁移脚本（stage字段+feedback字段+旧数据映射）"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-03]
allowed_paths:
  - backend/migrations/versions/
---

# task-02: DB迁移 — Alembic迁移脚本

## 目标

创建 Alembic 迁移脚本，为 `changes` 表添加工作流引擎所需的反馈字段（`feedback_category`、`feedback_text`），并将现有 `current_stage` 列中的旧数据统一映射到新的 10 阶段状态机体系。该迁移是 Wave 1 的基础任务，与 task-01（状态机核心）并行，后续 task-03（工作流服务）依赖本任务完成的数据结构。

**关键发现**：`current_stage` 列已由 `202605311700_add_change_approval_fields.py` 创建（nullable=True, 无 server_default）。本次迁移 **不重复创建** 该列，而是通过 UPDATE 语句修复已有脏数据并添加 server_default 约束。

## 修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/migrations/versions/<timestamp>_add_change_workflow_fields.py` | 新建 | Alembic 迁移脚本：添加 feedback 字段 + 修复 current_stage 数据 |

## 实现要求

### Step 1: 创建迁移脚本骨架

文件名格式：`<timestamp>_add_change_workflow_fields.py`

- `down_revision`: `"202605311700"`（当前 head，即 `add_change_approval_fields`）
- `revision`: 使用时间戳格式，如 `"202606010900"`
- 该脚本必须可在空表和有数据两种场景下安全执行

### Step 2: upgrade() — 添加 feedback 字段

```python
# 1. 添加 feedback_category 列（A/B/C/D 分类）
op.add_column(
    "changes",
    sa.Column("feedback_category", sa.String(1), nullable=True),
)

# 2. 添加 feedback_text 列（反馈详细文本）
op.add_column(
    "changes",
    sa.Column("feedback_text", sa.Text(), nullable=True),
)
```

- `feedback_category`：String(1)，nullable=True，取值为 `"A"` | `"B"` | `"C"` | `"D"`，应用层校验
- `feedback_text`：Text，nullable=True，无长度限制

### Step 3: upgrade() — 修复 current_stage 旧数据映射

`current_stage` 列已存在（nullable=True），但现有数据中存在 `NULL` 和旧阶段值。需执行数据修复：

```python
# 3. 修复 current_stage：NULL → 'draft'
op.execute("""
    UPDATE changes
    SET current_stage = 'draft'
    WHERE current_stage IS NULL
""")

# 4. 修复 current_stage：'created' → 'draft'（旧系统使用 'created' 作为初始阶段）
op.execute("""
    UPDATE changes
    SET current_stage = 'draft'
    WHERE current_stage = 'created'
""")
```

映射关系（来自 design.md §7.1）：

| 旧值 | 新值 | 说明 |
|------|------|------|
| `NULL` | `draft` | 未设置 stage 的旧记录统一归入草稿 |
| `created` | `draft` | 旧系统初始阶段名映射 |
| `draft` | `draft` | 保持不变 |
| `active` | `in_dev`（注：仅映射 status，current_stage 无 'active'） | — |
| 已有合法 stage 值 | 保持不变 | 如已有正确的 stage 无需修改 |

### Step 4: upgrade() — 添加 current_stage 的 server_default

```python
# 5. 为 current_stage 添加 server_default（新记录自动为 'draft'）
op.alter_column(
    "changes",
    "current_stage",
    server_default="draft",
)
```

- 确保 `current_stage` 列不再有 NULL 值（已由 Step 3 修复）
- 设置 `server_default='draft'` 使新插入记录自动获得正确的初始阶段

### Step 5: downgrade() — 回滚操作

```python
def downgrade() -> None:
    # 反向操作，严格按 upgrade 逆序
    op.alter_column(
        "changes",
        "current_stage",
        server_default=None,
    )
    op.drop_column("changes", "feedback_text")
    op.drop_column("changes", "feedback_category")
```

**注意**：downgrade 不恢复 current_stage 的旧值（数据修改不可逆），仅恢复列结构变更。这是一个有损回滚，在 migration docstring 中应注明。

### 接口定义

```python
"""add change workflow feedback fields and fix current_stage data

Revision ID: 202606010900
Revises: 202605311700
Create Date: 2026-06-01 09:00:00.000000

Adds:
  - feedback_category (String(1), nullable) — A/B/C/D 反馈分类
  - feedback_text (Text, nullable) — 反馈详细内容

Fixes:
  - current_stage: NULL → 'draft', 'created' → 'draft'
  - current_stage: adds server_default='draft'

WARNING: downgrade does NOT restore previous current_stage values.
"""

revision: str = "202606010900"
down_revision: str | None = "202605311700"
```

## 边界处理

1. **空表迁移**：`changes` 表无数据时，UPDATE 语句影响 0 行，不应报错。所有操作必须是幂等的。
2. **current_stage 含非法值**：若 `current_stage` 中存在不在映射表的值（如 `'pending'`、`'review'` 等），**不修改**，仅处理明确已知的 `NULL` 和 `'created'`。未知值留给后续手动清理。
3. **并发安全**：迁移脚本在 `alembic upgrade head` 时由 Alembic 锁控制单进程执行，无需额外处理并发。UPDATE 语句应使用 WHERE 条件精确匹配，避免全表锁。
4. **大表性能**：若 `changes` 表数据量超过 10 万行，UPDATE 应考虑分批执行（每批 5000 行）。当前阶段可直接执行，但在注释中预留分批方案。
5. **回滚不可逆**：downgrade 恢复列结构但不恢复数据。在脚本 docstring 中用 `WARNING` 标注。生产环境执行前必须确保有数据库备份。
6. **不修改 status 列**：本次迁移不触碰 `status` 列（`draft`/`active`/`archived`）。`status` → `stage` 的完整映射将在后续版本通过独立的迁移脚本完成，保证 API 兼容过渡期。

## 非目标

- ❌ 不修改 `status` 列或删除旧状态字段（兼容期内保留）
- ❌ 不添加 `reviewer_id` 列（design.md §2.3 提及，但实际在后续 task 中按需添加）
- ❌ 不添加 `stages` 列的 JSON 结构变更（该列已存在，后续由 service 层控制）
- ❌ 不重命名 `current_stage` 为 `stage`（保持字段名不变，避免破坏性变更）
- ❌ 不处理 `change_documents` 表（本次仅涉及 `changes` 表）
- ❌ 不在迁移中使用 ORM 模型（Alembic 最佳实践：仅使用 `op` + `sa`）

## TDD 步骤

### Test 1: 空表迁移不报错

```python
def test_upgrade_empty_table(alembic_engine):
    """changes 表无数据时 upgrade 应正常完成"""
    op.upgrade("head")
    # 验证列存在
    inspector = sa.inspect(alembic_engine)
    columns = {c["name"] for c in inspector.get_columns("changes")}
    assert "feedback_category" in columns
    assert "feedback_text" in columns
```

### Test 2: NULL → draft 映射

```python
def test_null_stage_mapped_to_draft(alembic_engine):
    """current_stage=NULL 的记录应映射为 'draft'"""
    # 插入一条 current_stage=NULL 的记录
    with alembic_engine.begin() as conn:
        conn.execute(
            changes_table.insert().values(
                id=uuid4(), workspace_id=WS_ID, change_key="test-1",
                status="draft", location="local", path="/tmp",
                current_stage=None,
            )
        )
    op.upgrade("head")
    with alembic_engine.begin() as conn:
        row = conn.execute(
            changes_table.select().where(changes_table.c.change_key == "test-1")
        ).fetchone()
        assert row.current_stage == "draft"
```

### Test 3: created → draft 映射

```python
def test_created_stage_mapped_to_draft(alembic_engine):
    """current_stage='created' 的记录应映射为 'draft'"""
    with alembic_engine.begin() as conn:
        conn.execute(
            changes_table.insert().values(
                id=uuid4(), workspace_id=WS_ID, change_key="test-2",
                status="draft", location="local", path="/tmp",
                current_stage="created",
            )
        )
    op.upgrade("head")
    with alembic_engine.begin() as conn:
        row = conn.execute(
            changes_table.select().where(changes_table.c.change_key == "test-2")
        ).fetchone()
        assert row.current_stage == "draft"
```

### Test 4: 合法 stage 值不被修改

```python
def test_valid_stage_unchanged(alembic_engine):
    """已有合法 current_stage 值不应被修改"""
    with alembic_engine.begin() as conn:
        conn.execute(
            changes_table.insert().values(
                id=uuid4(), workspace_id=WS_ID, change_key="test-3",
                status="active", location="local", path="/tmp",
                current_stage="in_dev",
            )
        )
    op.upgrade("head")
    with alembic_engine.begin() as conn:
        row = conn.execute(
            changes_table.select().where(changes_table.c.change_key == "test-3")
        ).fetchone()
        assert row.current_stage == "in_dev"
```

### Test 5: 新列 nullable 且默认为 NULL

```python
def test_feedback_columns_nullable(alembic_engine):
    """feedback_category 和 feedback_text 应为 nullable"""
    op.upgrade("head")
    with alembic_engine.begin() as conn:
        conn.execute(
            changes_table.insert().values(
                id=uuid4(), workspace_id=WS_ID, change_key="test-4",
                status="draft", location="local", path="/tmp",
                current_stage="draft",
                # 不传 feedback_category / feedback_text
            )
        )
        row = conn.execute(
            changes_table.select().where(changes_table.c.change_key == "test-4")
        ).fetchone()
        assert row.feedback_category is None
        assert row.feedback_text is None
```

### Test 6: downgrade 恢复列结构

```python
def test_downgrade_drops_columns(alembic_engine):
    """downgrade 应删除新增的 feedback 列"""
    op.upgrade("head")
    op.downgrade("202605311700")
    inspector = sa.inspect(alembic_engine)
    columns = {c["name"] for c in inspector.get_columns("changes")}
    assert "feedback_category" not in columns
    assert "feedback_text" not in columns
```

### Test 7: server_default 验证

```python
def test_server_default_draft(alembic_engine):
    """新插入记录的 current_stage 应自动为 'draft'"""
    op.upgrade("head")
    with alembic_engine.begin() as conn:
        # 不指定 current_stage，依赖 server_default
        conn.execute(
            text("""
                INSERT INTO changes (id, workspace_id, change_key, status, location, path)
                VALUES (:id, :ws, 'test-5', 'draft', 'local', '/tmp')
            """),
            {"id": str(uuid4()), "ws": str(WS_ID)},
        )
        row = conn.execute(
            text("SELECT current_stage FROM changes WHERE change_key = 'test-5'")
        ).fetchone()
        assert row[0] == "draft"
```

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 迁移脚本 `alembic upgrade head` 无报错执行完成 | 命令行 `cd backend && alembic upgrade head` |
| 2 | `feedback_category` 列已添加，类型 String(1)，nullable=True | `inspector.get_columns("changes")` 检查 |
| 3 | `feedback_text` 列已添加，类型 Text，nullable=True | `inspector.get_columns("changes")` 检查 |
| 4 | `current_stage` 为 NULL 的记录全部更新为 `'draft'` | `SELECT count(*) FROM changes WHERE current_stage IS NULL` 返回 0 |
| 5 | `current_stage = 'created'` 的记录全部更新为 `'draft'` | `SELECT count(*) FROM changes WHERE current_stage = 'created'` 返回 0 |
| 6 | `current_stage` 的 server_default 为 `'draft'` | 新插入记录不指定 current_stage 时自动为 `'draft'` |
| 7 | 已有合法 stage 值（如 `'in_dev'`、`'clarifying'`）未被修改 | 抽样对比迁移前后数据 |
| 8 | `alembic downgrade` 可正常回滚（删除新增列） | `alembic downgrade 202605311700` 无报错 |
| 9 | 不修改 `status` 列的任何值或结构 | 迁移前后 `SELECT DISTINCT status FROM changes` 结果一致 |
| 10 | 7 条 TDD 测试全部通过 | `pytest backend/tests/ -k "test_workflow_migration"` |
