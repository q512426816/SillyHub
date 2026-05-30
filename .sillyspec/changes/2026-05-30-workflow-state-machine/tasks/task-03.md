---
id: task-03
title: "ChangeDocument 新增 word_count 字段 + Alembic migration"
priority: P0
estimated_hours: 1
depends_on: [task-01]
blocks: [task-04]
allowed_paths:
  - backend/app/modules/change/model.py
  - backend/migrations/versions/
---

# task-03: ChangeDocument 新增 word_count 字段 + Alembic migration

## 修改文件（必填）
- `backend/app/modules/change/model.py` — ChangeDocument 新增 `word_count` 字段
- `backend/migrations/versions/<timestamp>_add_word_count_to_change_documents.py` — 新增 Alembic migration

## 实现要求

1. 在 `ChangeDocument` 类中新增 `word_count` 字段：
```python
from sqlalchemy import ..., Integer  # 确保 import Integer

word_count: int | None = Field(
    default=None,
    sa_column=Column(Integer, nullable=True),
)
```
2. 字段放在 `last_modified_at` 之后

3. 生成 Alembic migration 文件：
```bash
cd backend && alembic revision --autogenerate -m "add_word_count_to_change_documents"
```
4. 如果 autogenerate 不可用（SQLite 环境），手动编写 migration：
```python
def upgrade() -> None:
    op.add_column("change_documents", sa.Column("word_count", sa.Integer(), nullable=True))

def downgrade() -> None:
    op.drop_column("change_documents", "word_count")
```

## 接口定义（代码类任务必填）

```python
# backend/app/modules/change/model.py — ChangeDocument 类新增字段
class ChangeDocument(BaseModel, table=True):
    # ... 现有字段 ...
    last_modified_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    word_count: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
```

## 边界处理（必填）
- `word_count` 为 `nullable=True`，已有记录自动为 NULL，无需数据迁移
- NULL 表示"尚未计算"，guard 规则（task-04）需要处理 NULL = 0 的情况
- `default=None` 确保新建 ChangeDocument 时不强制要求 word_count
- SQLite 和 PostgreSQL 都支持 `Column(Integer, nullable=True)`
- migration 的 downgrade 必须能回滚（drop_column）
- 确保新增字段不影响现有的 `_sync_docs` 和 parser 逻辑

## 非目标（本任务不做的事）
- 不实现 word_count 的自动计算逻辑（在 task-04 或 change/service.py 中实现）
- 不修改 parser
- 不修改已有 migration

## 参考
- 现有 ChangeDocument 定义在 `backend/app/modules/change/model.py:71`
- Alembic migration 目录：`backend/migrations/versions/`
- 字段设计参考 design.md AD-3

## TDD 步骤
1. 修改 model.py 添加 word_count 字段
2. 确认 `from sqlalchemy import Integer` 已导入
3. 创建 Alembic migration
4. 运行 `pytest backend/app/modules/change/tests/` 确认通过
5. 运行全量测试确认回归

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 ChangeDocument 类定义 | 包含 `word_count: int \| None` 字段 |
| AC-02 | 检查字段属性 | `nullable=True`, `default=None` |
| AC-03 | migration 文件存在 | `add_word_count_to_change_documents` |
| AC-04 | migration upgrade | `op.add_column` 正确 |
| AC-05 | migration downgrade | `op.drop_column` 正确 |
| AC-06 | 运行全量测试 | 通过率不低于修改前 |
